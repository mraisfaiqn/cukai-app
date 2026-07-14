"""
Embedding + chunking helpers shared by:
  - pipeline.py  (ingestion side — embeds a newly classified document)
  - main.py      (chat side — embeds the user's question at query time)
  - seed_tax_law.py / seed_external_resources.py (bulk ingestion scripts)

Uses Google's gemini-embedding-001 via the same GEMINI_API_KEY already used
for classification in pipeline.py — one API key, no separate billing account.

NOTE: this was originally written against `models/text-embedding-004` on the
now-deprecated `google-generativeai` SDK. That SDK's v1beta endpoint no
longer serves text-embedding-004 (404 on embedContent), and Google's guidance
is to migrate to the unified `google-genai` SDK (`pip install google-genai`,
`from google import genai`). This module now uses that SDK with
`gemini-embedding-001`, explicitly truncated to output_dimensionality=768 via
Matryoshka Representation Learning so it stays a drop-in match for the
existing 768-dim MongoDB Atlas vector index (see mongo.py's
EMBEDDING_DIMENSIONS) — no index rebuild needed.

Embedding model MUST stay consistent between ingestion and query time, since
mixing embedding models (or output dimensions) breaks the cosine-similarity
math in vector_search().

RATE LIMITING: the free tier's embedding RPM (requests per minute) is low —
Google doesn't publish a fixed number since it's evaluated per-project, but
it's easily exhausted by a single large document (e.g. the full Income Tax
Act 1967 chunks into 1000+ pieces). embed_text() retries on 429 with
exponential backoff; embed_texts() also adds a small fixed delay between
calls to proactively stay under the limit rather than only reacting after
hitting it. This makes ingestion slower but far more likely to complete a
large document in one run instead of failing partway through.
"""

import logging
import os
import time

from google import genai
from google.genai import types
from google.genai import errors

logger = logging.getLogger("uvicorn.error")

EMBEDDING_MODEL = "gemini-embedding-001"

# Must match mongo.py's EMBEDDING_DIMENSIONS (the Atlas vector index's
# configured numDimensions). Google recommends 768, 1536, or 3072 — 768 is
# used here to match the index already created for this project.
EMBEDDING_OUTPUT_DIMENSIONS = 768

# Most single receipts fit in one chunk; this only matters for longer source
# text like tax-law reference PDFs or multi-page bank statements.
CHUNK_SIZE_CHARS    = 1500
CHUNK_OVERLAP_CHARS = 200

# Retry/backoff settings for 429 (RESOURCE_EXHAUSTED) responses. Exponential:
# 5s, 10s, 20s, 40s, 80s — five attempts total, ~2.5 minutes worst case before
# giving up on a single chunk, which is well past most free-tier RPM windows.
EMBED_MAX_RETRIES     = 5
EMBED_BACKOFF_BASE_S  = 5

# Fixed delay between successive embed_text calls inside embed_texts(), to
# proactively spread requests out rather than firing them back-to-back and
# relying entirely on retry-after-failure. 4s ≈ 15 requests/minute, a
# conservative rate that fits comfortably under typical free-tier RPM caps.
EMBED_THROTTLE_SECONDS = 4.0

_client = None


def _get_client() -> "genai.Client":
  """Lazily create and cache a single genai.Client for the process."""
  global _client
  if _client is None:
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
      raise EnvironmentError("GEMINI_API_KEY is not set.")
    _client = genai.Client(api_key=api_key)
  return _client



# Sentence/clause-ending punctuation used to snap chunk boundaries — tried in
# this order (strongest break first) before falling back to whitespace. Tax
# text is full of numbered sub-clauses ("(a)... (b)...") and semicolon-joined
# provisos, so semicolons and newlines are included alongside ".": a chunk
# that starts right after a "; " reads far more naturally than one that
# starts mid-clause, even though it isn't a full stop.
_SENTENCE_END_MARKERS = (". ", ".\n", "? ", "! ", ";\n", "; ", "\n\n", "\n")


def _rfind_sentence_end(text: str, start: int, end: int) -> int:
  """
  Search text[start:end] for the last sentence/clause-ending marker, and
  return the index just past it (i.e. where the next chunk should begin —
  on a capital letter or list marker, not mid-sentence). Returns -1 if none
  of the markers appear in the window.
  """
  best = -1
  for marker in _SENTENCE_END_MARKERS:
    idx = text.rfind(marker, start, end)
    if idx != -1:
      candidate = idx + len(marker)
      if candidate > best:
        best = candidate
  return best


def chunk_text(text: str, chunk_size: int = CHUNK_SIZE_CHARS, overlap: int = CHUNK_OVERLAP_CHARS) -> list[str]:
  """
  Split text into overlapping chunks by character count, snapped to sentence
  boundaries where possible (falling back to word boundaries, then a raw cut
  as a last resort). Still simple and deterministic rather than a full
  NLP-based sentence splitter — good enough for receipt summaries (which
  rarely need splitting at all) and long-form tax-law text.

  Boundaries are snapped to the nearest preceding sentence/clause end (".",
  "?", "!", ";", or a blank line — see _SENTENCE_END_MARKERS) rather than
  just the nearest whitespace. A naive `text[start:end]` slice, or even one
  snapped only to whitespace, can still land mid-sentence (e.g. a chunk
  starting with "shall be taken to be the amount of his adjusted loss..."
  with no idea what "the amount" refers to) — this reads as broken when a
  chunk's raw text is shown directly to a user as a citation snippet, see
  CukaiBot.jsx's CitationCard. Snapping to a sentence end costs a bit more
  chunk-size precision than whitespace-only snapping, but citations then
  start on a real sentence instead of a random word in the middle of one.

  Falls back to whitespace-snapping (word boundary) when no sentence-ending
  marker exists in the window — e.g. a run of numbered list fragments with
  no punctuation — and finally to a raw cut if there isn't even a space,
  so a pathological input (one giant unbroken token) still terminates.
  """
  text = (text or "").strip()
  if not text:
    return []
  if len(text) <= chunk_size:
    return [text]

  chunks = []
  start = 0
  while start < len(text):
    end = min(start + chunk_size, len(text))

    if end < len(text):
      # Prefer snapping to a sentence/clause end; fall back to whitespace;
      # fall back to the raw cut if neither is available in this window.
      snapped_end = _rfind_sentence_end(text, start, end)
      if snapped_end <= start:
        snapped_end = text.rfind(" ", start, end)
      if snapped_end > start:
        end = snapped_end

    chunks.append(text[start:end].strip())

    if end >= len(text):
      break

    # Snap the next start point back too, using the same rule, so the
    # overlap window also begins on a sentence/word boundary rather than
    # picking up mid-word or mid-sentence from the un-snapped position.
    next_start = max(end - overlap, 0)
    if next_start > start:
      snapped_start = _rfind_sentence_end(text, start, next_start)
      if snapped_start <= start:
        ws_snap = text.rfind(" ", start, next_start)
        if ws_snap > start:
          snapped_start = ws_snap + 1  # skip the space itself
      if snapped_start > start:
        next_start = snapped_start

    # Guarantee forward progress. Without this, a short window between
    # `start` and `next_start` with no snappable boundary in it can leave
    # next_start == start (or even push it backward), which would loop
    # forever — this was a real bug caught by testing, not a hypothetical.
    if next_start <= start:
      next_start = end
    start = next_start

  return [c for c in chunks if c]


# gemini-embedding-001 supports task_type directly (unlike gemini-embedding-2,
# which requires the task to be folded into the prompt text instead) — see
# the docstring note below for how task_type differs from the old SDK's
# lowercase strings.
_TASK_TYPE_MAP = {
  "retrieval_document": "RETRIEVAL_DOCUMENT",
  "retrieval_query":    "RETRIEVAL_QUERY",
}


def embed_text(text: str, task_type: str = "retrieval_document") -> list[float]:
  """
  Embed a single string with gemini-embedding-001, truncated to
  EMBEDDING_OUTPUT_DIMENSIONS. task_type should be "retrieval_document" when
  embedding content going INTO the vector store (ingestion) and
  "retrieval_query" when embedding the user's question at chat time — the
  embedding model uses this to bias the vector for its intended direction of
  the similarity search. Accepts the same lowercase values this module has
  always used; they're mapped to the SDK's UPPER_SNAKE_CASE enum internally.

  Retries automatically on 429 (RESOURCE_EXHAUSTED / rate limit) with
  exponential backoff — see EMBED_MAX_RETRIES/EMBED_BACKOFF_BASE_S. Other
  errors (bad request, auth failure, etc.) are raised immediately since
  retrying wouldn't help.
  """
  client = _get_client()

  attempt = 0
  while True:
    try:
      result = client.models.embed_content(
        model=EMBEDDING_MODEL,
        contents=text,
        config=types.EmbedContentConfig(
          task_type=_TASK_TYPE_MAP.get(task_type, task_type.upper()),
          output_dimensionality=EMBEDDING_OUTPUT_DIMENSIONS,
        ),
      )
      break
    except errors.APIError as e:
      is_rate_limit = getattr(e, "code", None) == 429
      attempt += 1
      if not is_rate_limit or attempt > EMBED_MAX_RETRIES:
        raise
      wait_s = EMBED_BACKOFF_BASE_S * (2 ** (attempt - 1))
      logger.warning(
        f"[Embeddings] Rate limited (429), retry {attempt}/{EMBED_MAX_RETRIES} "
        f"after {wait_s}s..."
      )
      time.sleep(wait_s)

  values = result.embeddings[0].values

  # gemini-embedding-001 (unlike gemini-embedding-2) does NOT auto-normalize
  # truncated (<3072) dimensions — per Google's docs, callers must manually
  # re-normalize or cosine similarity comparisons will be skewed. Atlas
  # $vectorSearch with similarity="cosine" already normalizes internally,
  # but we normalize here too so raw vectors are well-formed wherever else
  # they might be used (e.g. a future re-ranking step).
  norm = sum(v * v for v in values) ** 0.5
  if norm > 0:
    values = [v / norm for v in values]
  return values


def embed_texts(
  texts: list[str],
  task_type: str = "retrieval_document",
  on_chunk_done=None,
) -> list[list[float]]:
  """
  Embed multiple strings. Kept as a loop (rather than a single batched call)
  so a single failed chunk raises immediately instead of silently dropping a
  chunk, and so per-chunk task_type stays simple. A small fixed delay
  (EMBED_THROTTLE_SECONDS) is inserted between calls to stay under free-tier
  RPM proactively; embed_text() itself also retries on 429 reactively.

  `on_chunk_done`, if given, is called as on_chunk_done(index, vector) right
  after each chunk succeeds — callers doing bulk ingestion (e.g.
  seed_external_resources.py) can use this to persist progress incrementally,
  so a failure on chunk N (after retries are exhausted) doesn't lose the
  N-1 chunks already embedded.
  """
  vectors = []
  for i, t in enumerate(texts):
    vector = embed_text(t, task_type=task_type)
    vectors.append(vector)
    if on_chunk_done is not None:
      on_chunk_done(i, vector)
    if i < len(texts) - 1:
      time.sleep(EMBED_THROTTLE_SECONDS)
  return vectors
