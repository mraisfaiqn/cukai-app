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

// ── Documents ─────────────────────────────────────────────────────────────────

/**
 * Upload a single file for classification.
 * Returns { document_id, file_name, status }.
 */
export const uploadDocument = async (file, userId = null) => {
  const form = new FormData();
  form.append('file', file);
  const params = userId ? { user_id: userId } : {};
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
export const batchUploadDocuments = async (files, userId = null) => {
  const form = new FormData();
  files.forEach((f) => form.append('files', f));
  const params = userId ? { user_id: userId } : {};
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
export const getDocumentStatus = async (docId, userId = null) => {
  const params = userId ? { user_id: userId } : {};
  const { data } = await api.get(`/api/documents/${docId}/status`, { params });
  return data;
};

/** Fetch the full record for a single document. */
export const getDocument = async (docId, userId = null) => {
  const params = userId ? { user_id: userId } : {};
  const { data } = await api.get(`/api/documents/${docId}`, { params });
  return data;
};

/** List all documents, optionally scoped to a user and/or year of assessment. */
export const getDocuments = async (userId = null, year = null) => {
  const params = {};
  if (userId) params.user_id = userId;
  if (year)   params.year    = year;
  const { data } = await api.get('/api/documents', { params });
  return data;
};

/** Permanently delete a document record and its file on disk. */
export const deleteDocument = async (docId, userId = null) => {
  const params = userId ? { user_id: userId } : {};
  const { data } = await api.delete(`/api/documents/${docId}`, { params });
  return data;
};

/** Set a document's status to 'archived'. */
export const archiveDocument = async (docId, userId = null) => {
  const params = userId ? { user_id: userId } : {};
  const { data } = await api.patch(`/api/documents/${docId}/archive`, {}, { params });
  return data;
};

/**
 * Override the AI classification with a user-confirmed status and category.
 * Returns the updated Document record.
 */
export const reclassifyDocument = async (docId, status, category, userId = null) => {
  const params = userId ? { user_id: userId } : {};
  const { data } = await api.patch(
    `/api/documents/${docId}/reclassify`,
    { status, category },
    { params },
  );
  return data;
};

// ── Tax profile ───────────────────────────────────────────────────────────────

/**
 * Fetch the aggregated tax profile summary for a given year of assessment.
 * Includes income, deductions, reliefs, CP500, YoY trend, and projections.
 */
export const getTaxProfileSummary = async (year, userId = null) => {
  const params = { year };
  if (userId) params.user_id = userId;
  const { data } = await api.get('/api/profile/summary', { params });
  return data;
};

/**
 * Fetch the structured Form B data extracted from a previously filed return.
 * Returns null if no Form B has been uploaded for that year.
 */
export const getFormBProfile = async (year, userId = null) => {
  const params = userId ? { user_id: userId } : {};
  const { data } = await api.get(`/api/profile/form-b/${year}`, { params });
  return data;
};