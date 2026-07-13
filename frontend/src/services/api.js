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
 * Create a new entity under a person.
 * `payload` should use camelCase keys matching the backend's expected shape.
 * Returns the newly created Entity record.
 */
export const createEntity = async (personId, payload) => {
  const { data } = await api.post(`/entities/${personId}`, payload);
  return data;
};

/**
 * Persist edits to an existing entity.
 * Returns the updated Entity record.
 */
export const updateEntity = async (entityId, payload) => {
  const { data } = await api.put(`/entities/${entityId}`, payload);
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
 * Permanently delete an entity.
 * Returns { deleted: true, id }.
 */
export const deleteEntity = async (entityId) => {
  const { data } = await api.delete(`/entities/${entityId}`);
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

/**
 * Fetch the insight feed for a user, optionally scoped to one entity.
 * Omit entityId to aggregate across all of the user's entities. `state`
 * optionally filters by lifecycle (new | read | dismissed | actioned).
 * Returns an array of insight rows (already shaped like the InsightsInbox card).
 */
export const getInsights = async (userId = null, entityId = null, state = null) => {
  const params = {};
  if (userId)   params.user_id   = userId;
  if (entityId) params.entity_id = entityId;
  if (state)    params.state     = state;
  const { data } = await api.get('/api/insights', { params });
  return data;
};

/**
 * Transition a single insight's lifecycle state (read | dismissed | actioned).
 * `reason` carries the dismiss reason for "dismiss with memory" so a later
 * regeneration won't resurrect the card. Returns the updated insight row.
 */
export const updateInsightState = async (insightId, state, reason = null, userId = null, entityId = null) => {
  const params = {};
  if (userId)   params.user_id   = userId;
  if (entityId) params.entity_id = entityId;
  const body = { state };
  if (reason !== null && reason !== undefined && reason !== '') body.reason = reason;
  const { data } = await api.patch(`/api/insights/${insightId}/state`, body, { params });
  return data;
};