import axios from 'axios';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';

const api = axios.create({ baseURL: API_URL });

// ── Auth / Users ─────────────────────────────────────────────────────────────

export const createUser = async (userData) => {
  const { data } = await api.post('/api/users', userData);
  return data;
};

export const userLogin = async (email, password) => {
  const { data } = await api.post('/api/auth/login', { email, password });
  return data;
};

// ── Documents ────────────────────────────────────────────────────────────────

/** Upload a single file. Returns { document_id, file_name, status } */
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

/** Batch upload up to 10 files. Returns { queued, errors, total_queued, total_failed } */
export const batchUploadDocuments = async (files, userId = null) => {
  const form = new FormData();
  files.forEach(f => form.append('files', f));
  const params = userId ? { user_id: userId } : {};
  const { data } = await api.post('/api/documents/batch-upload', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
    params,
  });
  return data;
};

/** Poll a single document's status. Returns { id, status, document_type, category, ... } */
export const getDocumentStatus = async (docId, userId = null) => {
  const params = userId ? { user_id: userId } : {};
  const { data } = await api.get(`/api/documents/${docId}/status`, { params });
  return data;
};

/** Get a single document's full record. */
export const getDocument = async (docId, userId = null) => {
  const params = userId ? { user_id: userId } : {};
  const { data } = await api.get(`/api/documents/${docId}`, { params });
  return data;
};

/** List all documents, optionally filtered by user_id and/or year. */
export const getDocuments = async (userId = null, year = null) => {
  const params = {};
  if (userId) params.user_id = userId;
  if (year) params.year = year;
  const { data } = await api.get('/api/documents', { params });
  return data;
};

/** Delete a document record and its file from disk. */
export const deleteDocument = async (docId, userId = null) => {
  const params = userId ? { user_id: userId } : {};
  const { data } = await api.delete(`/api/documents/${docId}`, { params });
  return data;
};

/** Archive a document (PATCH status to 'archived'). */
export const archiveDocument = async (docId, userId = null) => {
  const params = userId ? { user_id: userId } : {};
  const { data } = await api.patch(`/api/documents/${docId}/archive`, {}, { params });
  return data;
};

/** Re-classify a document with a user-confirmed status and category. */
export const reclassifyDocument = async (docId, status, category, userId = null) => {
  const params = userId ? { user_id: userId } : {};
  const { data } = await api.patch(
    `/api/documents/${docId}/reclassify`,
    { status, category },
    { params }
  );
  return data;
};

// ── Tax profile ──────────────────────────────────────────────────────────────

/** Get the full tax profile summary for a given YA. */
export const getTaxProfileSummary = async (year, userId = null) => {
  const params = { year };
  if (userId) params.user_id = userId;
  const { data } = await api.get('/api/profile/summary', { params });
  return data;
};

/** Get the Form B profile for a given YA. */
export const getFormBProfile = async (year, userId = null) => {
  const params = userId ? { user_id: userId } : {};
  const { data } = await api.get(`/api/profile/form-b/${year}`, { params });
  return data;
};