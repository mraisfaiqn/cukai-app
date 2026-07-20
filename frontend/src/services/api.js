/**
 * api.js — centralised HTTP client for all cukai.ai backend calls.
 *
 * All requests go through the `api` axios instance so the base URL is
 * configured in one place via the VITE_API_URL env variable.  Every export
 * is a named async function that maps 1-to-1 with a backend endpoint.
 */

import axios from 'axios';

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || 'http://localhost:8000',
});

// ── Auth ─────────────────────────────────────────────────────────────────────

/** Register a new user and their first entity. Returns the created Person record. */
export const registerUser = async (payload) => {
  const { data } = await api.post('/userReg', payload);
  return data;
};

/** Authenticate an existing user. Returns { id, fullName }. */
export const userLogin = async (email, password) => {
  const { data } = await api.post('/userLogin', { email, password });
  return data;
};

// ── Person / profile ──────────────────────────────────────────────────────────

/** Fetch all personal details for a person by their database ID. */
export const getPersonalDetails = async (personId) => {
  const { data } = await api.get(`/personalDetails/${personId}`);
  return data;
};

/** Overwrite the mutable fields of a person's profile. Returns the updated Person record. */
export const updateProfile = async (personId, payload) => {
  const { data } = await api.put(`/userProfile/${personId}`, payload);
  return data;
};

// ── Children (Form B H16 relief records) ──────────────────────────────────────
// Phase 3 (14 Jul 2026): per-child records driving real H16a/b/c tiering,
// replacing the flat numberOfChildren count. See models.py's Child model
// and child_relief.py for the computation these records feed.

/** Fetch every child record for a person. */
export const getChildren = async (personId) => {
  const { data } = await api.get(`/children/${personId}`);
  return data;
};

/**
 * Add a new child record. `payload` should include: name, dateOfBirth
 * (YYYY-MM-DD, required), and optionally identificationNo, isDisabled,
 * isFullTimeStudent, isHigherEducation, eligibilityPct (50 or 100).
 */
export const createChild = async (personId, payload) => {
  const { data } = await api.post(`/children/${personId}`, payload);
  return data;
};

/**
 * Update an existing child record. `personId` is required so the backend
 * can verify this child actually belongs to the caller before editing it —
 * see main.py's _scoped_child_or_404. Returns the updated Child record.
 */
export const updateChild = async (childId, personId, payload) => {
  const { data } = await api.put(`/children/${childId}`, payload, { params: { person_id: personId } });
  return data;
};

/**
 * Remove a child record. `personId` is required for the same ownership-
 * scoping reason as updateChild. Returns { deleted: true, id }.
 */
export const deleteChild = async (childId, personId) => {
  const { data } = await api.delete(`/children/${childId}`, { params: { person_id: personId } });
  return data;
};

// ── Entities ─────────────────────────────────────────────────────────────────

/**
 * Fetch every entity belonging to a person.
 * Returns an array of serialised Entity objects.
 */
export const getAllEntities = async (personId) => {
  const { data } = await api.get(`/entities/${personId}`);
  return data;
};

/**
 * Fetch the canonical document category taxonomy, grouped by bucket.
 * This is the SINGLE SOURCE the reclassify dropdown (CukaiAccount.jsx)
 * builds itself from — replacing the old hand-copied category arrays that
 * drifted out of sync with the backend across several taxonomy refactors
 * (the CP500 split, the H6/H7/H8 granularity split, and — most concretely —
 * Bank Statement never being added as a selectable option at all, which
 * caused a confirmed bug where the reclassify dropdown showed the wrong
 * category for a bank statement document). Static taxonomy data, identical
 * for every user — no personId/auth needed.
 * Returns { groups: [{ bucket, groupLabel, categories: [{ value, label, status }] }] }.
 */
export const getCategories = async () => {
  const { data } = await api.get('/api/categories');
  return data;
};

/**
 * Create a new entity under a person.
 * `payload` should use camelCase keys matching the backend's expected shape.
 * Returns the newly created Entity record.
 */
export const createEntity = async (personId, payload) => {
  const { data } = await api.post(`/entities/${personId}`, payload);
  return data;
};

/**
 * Persist edits to an existing entity. `personId` is required so the
 * backend can verify this entity actually belongs to the caller before
 * editing it — see main.py's _scoped_entity_or_404.
 * Returns the updated Entity record.
 */
export const updateEntity = async (entityId, personId, payload) => {
  const { data } = await api.put(`/entities/${entityId}`, payload, { params: { person_id: personId } });
  return data;
};

/**
 * Fetch a single entity by its database ID.
 * Used by dashboard pages to load the active entity from localStorage('activeEntityId').
 */
export const getEntityById = async (entityId, userId = null) => {
  const params = userId ? { user_id: userId } : {};
  const { data } = await api.get(`/entities/detail/${entityId}`, { params });
  return data;
};

/**
 * Fetch a SUGGESTED opening carry-forward balance for an entity, derived
 * from a prior filed Form B (year targetYear - 1) the user has already
 * uploaded and had extracted — if one exists. Never writes anything; the
 * caller must still go through the normal updateEntity() save flow to
 * apply it, same "Suggested Match, not auto-applied" pattern as the
 * invoice-matching UI. Returns { available: false } when no prior filing
 * exists (or it has no carry-forward figures) for that year.
 */
export const getOpeningBalanceSuggestion = async (entityId, targetYear, userId = null) => {
  const params = { target_year: targetYear, ...(userId ? { user_id: userId } : {}) };
  const { data } = await api.get(`/entities/${entityId}/opening-balance-suggestion`, { params });
  return data;
};

/**
 * Permanently delete an entity. `personId` is required for the same
 * ownership-scoping reason as updateEntity.
 * Returns { deleted: true, id }.
 */
export const deleteEntity = async (entityId, personId) => {
  const { data } = await api.delete(`/entities/${entityId}`, { params: { person_id: personId } });
  return data;
};

// ── Documents ─────────────────────────────────────────────────────────────────
// Every function accepts an optional entityId so documents stay scoped to the
// active business entity. Pass the same entityId used to resolve the active
// entity (typically localStorage('activeEntityId')) for consistent scoping
// across upload, list, status, get, delete, archive, and reclassify calls.

/**
 * Persist a manually-entered document (no file, no OCR) — used by the
 * "Manually add a document" flow when a receipt can't be uploaded as a file.
 * `payload` should include: vendor, vendor_addr, doc_no, date (YYYY-MM-DD),
 * document_type, category, line_items ([{desc, amt}]), notes.
 * Returns the created Document record (already status: 'completed').
 */
export const createManualDocument = async (payload, userId = null, entityId = null) => {
  const params = {};
  if (userId)   params.user_id   = userId;
  if (entityId) params.entity_id = entityId;
  const { data } = await api.post('/api/documents/manual', payload, { params });
  return data;
};

/**
 * Upload a single file for classification.
 * Returns { document_id, file_name, status }.
 */
export const uploadDocument = async (file, userId = null, entityId = null) => {
  const form = new FormData();
  form.append('file', file);
  const params = {};
  if (userId)   params.user_id   = userId;
  if (entityId) params.entity_id = entityId;
  const { data } = await api.post('/api/documents/upload', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
    params,
  });
  return data;
};

/**
 * Upload up to 10 files in a single request.
 * Returns { queued, errors, total_queued, total_failed }.
 */
export const batchUploadDocuments = async (files, userId = null, entityId = null) => {
  const form = new FormData();
  files.forEach((f) => form.append('files', f));
  const params = {};
  if (userId)   params.user_id   = userId;
  if (entityId) params.entity_id = entityId;
  const { data } = await api.post('/api/documents/batch-upload', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
    params,
  });
  return data;
};

/**
 * Poll the processing status of a single document.
 * Returns { id, status, document_type, category, … }.
 */
export const getDocumentStatus = async (docId, userId = null, entityId = null) => {
  const params = {};
  if (userId)   params.user_id   = userId;
  if (entityId) params.entity_id = entityId;
  const { data } = await api.get(`/api/documents/${docId}/status`, { params });
  return data;
};

/** Fetch the full record for a single document. */
export const getDocument = async (docId, userId = null, entityId = null) => {
  const params = {};
  if (userId)   params.user_id   = userId;
  if (entityId) params.entity_id = entityId;
  const { data } = await api.get(`/api/documents/${docId}`, { params });
  return data;
};

/** List all documents, optionally scoped to a user, entity, and/or year of assessment. */
export const getDocuments = async (userId = null, entityId = null, year = null) => {
  const params = {};
  if (userId)   params.user_id   = userId;
  if (entityId) params.entity_id = entityId;
  if (year)     params.year      = year;
  const { data } = await api.get('/api/documents', { params });
  return data;
};

/** Permanently delete a document record and its file on disk. */
export const deleteDocument = async (docId, userId = null, entityId = null) => {
  const params = {};
  if (userId)   params.user_id   = userId;
  if (entityId) params.entity_id = entityId;
  const { data } = await api.delete(`/api/documents/${docId}`, { params });
  return data;
};

/** Set a document's status to 'archived'. */
export const archiveDocument = async (docId, userId = null, entityId = null) => {
  const params = {};
  if (userId)   params.user_id   = userId;
  if (entityId) params.entity_id = entityId;
  const { data } = await api.patch(`/api/documents/${docId}/archive`, {}, { params });
  return data;
};

/** Restore an archived document back to the main list (status: 'completed'). */
export const unarchiveDocument = async (docId, userId = null, entityId = null) => {
  const params = {};
  if (userId)   params.user_id   = userId;
  if (entityId) params.entity_id = entityId;
  const { data } = await api.patch(`/api/documents/${docId}/unarchive`, {}, { params });
  return data;
};

/**
 * Toggle a bank statement's review flag — this is what lets a bank
 * statement actually resolve out of "needs review" once the user has
 * looked at its unmatched lines and confirmed there's nothing missing.
 * Only valid for documents whose category is a bank statement (422
 * otherwise). `reviewed` is a toggle, not one-directional — pass false to
 * re-open review later if needed.
 */
export const markDocumentReviewed = async (docId, reviewed = true, userId = null, entityId = null) => {
  const params = {};
  if (userId)   params.user_id   = userId;
  if (entityId) params.entity_id = entityId;
  const { data } = await api.patch(`/api/documents/${docId}/mark-reviewed`, { reviewed }, { params });
  return data;
};

/**
 * Re-run OCR/classification on a previously failed document using the file
 * already stored on disk. Returns { document_id, status: 'pending' }.
 */
export const retryDocument = async (docId, userId = null, entityId = null) => {
  const params = {};
  if (userId)   params.user_id   = userId;
  if (entityId) params.entity_id = entityId;
  const { data } = await api.patch(`/api/documents/${docId}/retry`, {}, { params });
  return data;
};

/**
 * Override the AI classification with a user-confirmed status and category.
 * Pass `amount` and/or `date` when the original OCR extraction failed to
 * capture them — each overwrites the corresponding extractedData field on
 * the backend. `date` should be an ISO YYYY-MM-DD string.
 * `deductiblePct` (0–100) applies only to apportioned Q3 categories
 * (client entertainment, gifts, mixed-use vehicle, hire purchase) and tells
 * the backend what portion of the amount is deductible; it's ignored for
 * every other category.
 * Returns the updated Document record.
 */
export const reclassifyDocument = async (docId, status, category, userId = null, entityId = null, amount = null, date = null, deductiblePct = null) => {
  const params = {};
  if (userId)   params.user_id   = userId;
  if (entityId) params.entity_id = entityId;
  const body = { status, category };
  if (amount !== null && amount !== undefined && amount !== '') body.amount = amount;
  if (date !== null && date !== undefined && date !== '') body.date = date;
  if (deductiblePct !== null && deductiblePct !== undefined && deductiblePct !== '') body.deductible_pct = deductiblePct;
  const { data } = await api.patch(
    `/api/documents/${docId}/reclassify`,
    body,
    { params },
  );
  return data;
};

/**
 * Revert a user-edited document to the LLM's original classification
 * (category, status, amount, date, year of assessment). Only valid once the
 * document has been edited at least once. Returns the reset Document record.
 */
export const resetDocument = async (docId, userId = null, entityId = null) => {
  const params = {};
  if (userId)   params.user_id   = userId;
  if (entityId) params.entity_id = entityId;
  const { data } = await api.patch(`/api/documents/${docId}/reset`, {}, { params });
  return data;
};

// ── Tax profile ───────────────────────────────────────────────────────────────

/**
 * Fetch the aggregated tax profile summary for a given year of assessment.
 * Includes income, deductions, reliefs, CP500, YoY trend, and projections.
 * Pass entityId to scope the summary to a single business entity — omit it
 * to aggregate across all of the user's entities.
 */
export const getTaxProfileSummary = async (year, userId = null, entityId = null) => {
  const params = { year };
  if (userId)   params.user_id   = userId;
  if (entityId) params.entity_id = entityId;
  const { data } = await api.get('/api/profile/summary', { params });
  return data;
};

// ── AI Insights ───────────────────────────────────────────────────────────────

/**
 * Fetch the AI Insights feed for a user (optionally scoped to an entity).
 * Returns a WRAPPED payload: { insights: [...], lastRun: {...}|null } —
 * consumers must read `.insights`, not map the response directly.
 */
export const getInsights = async (userId, entityId = null) => {
  const params = { user_id: userId };
  if (entityId) params.entity_id = entityId;
  const { data } = await api.get('/api/insights', { params });
  return data;
};

/**
 * Transition an insight's lifecycle state.
 * `payload` is { state: 'new'|'read'|'dismissed'|'actioned', dismissReason?,
 * snoozeUntil? (YYYY-MM-DD), resolvedNote? }. Dismiss reasons containing
 * "snooze" auto-snooze for 2 weeks; "Not relevant this year" hides the card
 * until 1 Jan after its assessment year. Returns the updated insight.
 */
export const updateInsightState = async (insightId, payload, userId) => {
  const { data } = await api.patch(`/api/insights/${insightId}/state`, payload, {
    params: { user_id: userId },
  });
  return data;
};

/**
 * Queue a manual re-run of the insight engine (fire-and-forget, 202).
 * The refreshed feed lands on the next getInsights() call.
 */
export const runInsightEngine = async (userId, entityId = null) => {
  const params = { user_id: userId };
  if (entityId) params.entity_id = entityId;
  const { data } = await api.post('/api/insights/run', {}, { params });
  return data;
};

/**
 * Fetch the structured Form B data extracted from a previously filed return.
 * Pass entityId to scope to a specific business entity (each entity keeps its
 * own filed Form B per year); omit it for the no-entity record.
 * Returns null if no Form B has been uploaded for that year.
 */
export const getFormBProfile = async (year, userId = null, entityId = null) => {
  const params = {};
  if (userId)   params.user_id   = userId;
  if (entityId) params.entity_id = entityId;
  const { data } = await api.get(`/api/profile/form-b/${year}`, { params });
  return data;
};

// ── Insights ──────────────────────────────────────────────────────────────────
// The AI insight feed is scoped to a user and (optionally) a single business
// entity, exactly like documents and the tax profile summary. Pass the same
// entityId used elsewhere (typically localStorage('activeEntityId')) so
// switching entities returns that entity's own insights.


// ── CukaiBot chat ────────────────────────────────────────────────────────────
// Backs the retrieval-chat loop: PostgreSQL session history + MongoDB vector
// search + Gemini generation. session_id is optional on the first message —
// the backend creates one automatically and returns it, the same way a new
// WhatsApp thread gets an ID on its first message.

/**
 * List a page of a user's chat sessions, optionally scoped to one entity,
 * most recently updated first. Defaults to the 20 most recent — pass a
 * larger `offset` to fetch older pages (e.g. when the sidebar list is
 * scrolled to the bottom) rather than ever pulling a user's entire chat
 * history in one request.
 * Returns { sessions: [{ sessionId, entityId, title, pinned, pinnedAt, folder, createdAt, updatedAt }], hasMore }.
 */
export const getChatSessions = async (userId, entityId = null, limit = 20, offset = 0) => {
  const params = { user_id: userId, limit, offset };
  if (entityId) params.entity_id = entityId;
  const { data } = await api.get('/api/chat/sessions', { params });
  return data;
};

/**
 * Search a user's chat sessions by both title and message content (unlike
 * getChatSessions, this isn't paginated with offset/scroll — it's a single
 * ranked results list, most-recently-updated first). Pass an empty/whitespace
 * query and the caller should skip calling this entirely rather than hitting
 * the backend with it.
 * Returns { results: [{ sessionId, entityId, title, updatedAt, matchedIn: 'title'|'message', snippet }] }.
 */
export const searchChatSessions = async (query, userId, entityId = null, limit = 20) => {
  const params = { q: query, user_id: userId, limit };
  if (entityId) params.entity_id = entityId;
  const { data } = await api.get('/api/chat/search', { params });
  return data;
};

/**
 * Fetch the full message history for one chat session, oldest first.
 * Returns { sessionId, entityId, messages: [{id, role, text, citations, followups, attachments}] }.
 * followups is only ever populated on assistant messages (null on user
 * messages, and on assistant messages saved before this field existed).
 * attachments is a list of {id, title, sourceUrl, fileType, mimeType, fileSize}
 * (null when the message has none) — same shape citations use for
 * DocumentPreviewModal, so attachments preview the same way.
 */
export const getChatHistory = async (sessionId, userId) => {
  const { data } = await api.get(`/api/chat/${sessionId}/history`, { params: { user_id: userId } });
  return data;
};

/**
 * Send a chat message and get back the assistant's reply.
 * Pass `sessionId = null` to start a new session — the response's
 * `sessionId` should then be stored (e.g. in state) and passed on
 * subsequent calls to keep the same thread.
 * Pass `attachmentIds` (from prior uploadChatAttachment calls) to link
 * already-uploaded files to this message — the backend sends their bytes
 * to Gemini alongside the message text (see main.py's post_chat_message).
 * `message` may be an empty string when attachmentIds is non-empty
 * (attachment-only message).
 * Returns { sessionId, userMessage: {id, role, text, attachments}, message: {id, role, text, citations, followups} }.
 * followups is an array of up to 3 AI-suggested next questions for THIS
 * reply (may be empty, e.g. on a generation error) — drives the chip tray
 * under the conversation instead of a fixed static prompt list.
 */
export const sendChatMessage = async (message, userId, entityId = null, sessionId = null, attachmentIds = []) => {
  const body = { message, user_id: userId };
  if (entityId)  body.entity_id  = entityId;
  if (sessionId) body.session_id = sessionId;
  if (attachmentIds && attachmentIds.length) body.attachment_ids = attachmentIds;
  const { data } = await api.post('/api/chat', body);
  return data;
};

/**
 * Upload a file to attach to the next chat message. Uploads immediately
 * (before the message itself is sent), so the composer can show an
 * attached-file chip right away — pass the returned `id` in `sendChatMessage`'s
 * `attachmentIds` when the message is actually sent.
 * `sessionId` is optional (a brand-new conversation has none yet); pass it
 * when attaching a file to an existing conversation so it's validated
 * up front rather than only at send time.
 * Returns { id, title, sourceUrl, fileType, mimeType, fileSize }.
 */
export const uploadChatAttachment = async (file, userId, sessionId = null) => {
  const formData = new FormData();
  formData.append('file', file);
  const params = { user_id: userId };
  if (sessionId) params.session_id = sessionId;
  const { data } = await api.post('/api/chat/attachments', formData, {
    params,
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return data;
};

/**
 * Remove a pending (not-yet-sent) attachment — e.g. the user clicks the
 * 'x' on an attached-file chip before sending. Fails with 409 if the
 * attachment has already been linked to a sent message.
 */
export const deleteChatAttachment = async (attachmentId, userId) => {
  const { data } = await api.delete(`/api/chat/attachments/${attachmentId}`, { params: { user_id: userId } });
  return data;
};

/** Permanently delete a chat session and all its messages. */
export const deleteChatSession = async (sessionId, userId) => {
  const { data } = await api.delete(`/api/chat/${sessionId}`, { params: { user_id: userId } });
  return data;
};

/**
 * Partial-update a session's sidebar-facing fields — backs the sidebar's
 * 3-dot menu (Pin/Unpin, Rename, Add to folder/Remove from folder). Pass
 * only the fields being changed; e.g. `{ pinned: true }` to pin without
 * touching the title or folder. Pass `folder: null` to remove a session
 * from its folder.
 * Returns the updated session: { sessionId, entityId, title, pinned, pinnedAt, folder, createdAt, updatedAt }.
 */
export const updateChatSession = async (sessionId, userId, updates) => {
  const { data } = await api.patch(`/api/chat/${sessionId}`, updates, { params: { user_id: userId } });
  return data;
};

/**
 * List the distinct folder names a user has created, optionally scoped to
 * one entity — backs the "Add to folder" picker so it can offer existing
 * folders instead of only ever letting the user create a new one.
 * Returns { folders: string[] }.
 */
export const getChatFolders = async (userId, entityId = null) => {
  const params = { user_id: userId };
  if (entityId) params.entity_id = entityId;
  const { data } = await api.get('/api/chat/folders', { params });
  return data;
};

/**
 * Rename a folder — bulk-renames the folder tag on every session currently
 * filed under `folderName` to `newName`, since a folder isn't its own row,
 * just a shared text tag on however many ChatSession records carry it.
 * Returns { folder: newName, updated: <count of sessions renamed> }.
 */
export const renameChatFolder = async (folderName, newName, userId, entityId = null) => {
  const params = { user_id: userId };
  if (entityId) params.entity_id = entityId;
  const { data } = await api.patch(`/api/chat/folders/${encodeURIComponent(folderName)}`, { name: newName }, { params });
  return data;
};

/**
 * Delete a folder — un-files every session tagged `folderName` (their
 * `folder` becomes null) without deleting the conversations themselves.
 * Returns { updated: <count of sessions un-filed> }.
 */
export const deleteChatFolder = async (folderName, userId, entityId = null) => {
  const params = { user_id: userId };
  if (entityId) params.entity_id = entityId;
  const { data } = await api.delete(`/api/chat/folders/${encodeURIComponent(folderName)}`, { params });
  return data;
};