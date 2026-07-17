"""Small shared helpers used by both pipeline.py and main.py."""

from decimal import Decimal, InvalidOperation, ROUND_HALF_UP

# Money is represented as Decimal end-to-end through the aggregation/tax layers
# so repeated sums and percentage math don't accumulate binary-float error.
# Values are only converted to float at the JSON response boundary (FastAPI's
# jsonable_encoder does this automatically for Decimal).
_CENTS = Decimal("0.01")


def parse_amount(val) -> Decimal:
  """
  Parse a currency-formatted amount (e.g. "RM 1,240.00", 1240, "1240.00")
  into a Decimal. Returns Decimal("0") for None or anything that doesn't parse
  — never raises, since this is used inline while building aggregation totals.

  Always routes through str() before constructing the Decimal so that a float
  input (e.g. 0.1) is parsed from its decimal string rather than its exact
  binary value.
  """
  if val is None:
    return Decimal("0")
  try:
    cleaned = str(val).replace("RM", "").replace(",", "").strip()
    if cleaned == "":
      return Decimal("0")
    return Decimal(cleaned)
  except (ValueError, TypeError, InvalidOperation):
    return Decimal("0")


def money(value) -> Decimal:
  """
  Quantize any numeric value to 2 decimal places (cents) as a Decimal, using
  conventional half-up rounding for currency. Use this everywhere the code
  previously did round(x, 2) on a money figure.

  Accepts Decimal (kept exact), or int/float/str (routed through str() so a
  raw float doesn't inject binary error). Never raises on ordinary numbers.
  """
  if not isinstance(value, Decimal):
    try:
      value = Decimal(str(value))
    except (ValueError, TypeError, InvalidOperation):
      return Decimal("0.00")
  return value.quantize(_CENTS, rounding=ROUND_HALF_UP)


def extract_llm_text(response) -> str:
  """
  Read the text out of a LangChain chat model response, regardless of
  whether .content is a plain string (older/other providers) or a list of
  content-block dicts (Gemini 3+ via langchain-google-genai, which always
  emits [{"type": "text", "text": "...", ...}, ...] rather than a bare
  string). A non-text block (e.g. a "thinking" block with no "text" key)
  contributes "" instead of raising or leaking into the joined output.

  Joins with "" (not " ") since contiguous text blocks are parts of one
  continuous answer, not separate words.
  """
  content = response.content if hasattr(response, "content") else ""
  if isinstance(content, list):
    return "".join(
      block.get("text", "") if isinstance(block, dict) else str(block)
      for block in content
    ).strip()
  return str(content).strip() if content is not None else ""