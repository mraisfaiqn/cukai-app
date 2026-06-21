import axios from 'axios';

// Base URL for the FastAPI backend. Defaults to the local uvicorn port (8000);
// override with VITE_API_URL in a .env file if your backend runs elsewhere.
const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';

export const test = async () => {
  try {
    const response = await axios.get(`${API_URL}/test`)
    console.log(response.data)
  } catch (error) {
    console.error('Error testing API end-point:', error)
  }
}

// ── Tax relief calculator ─────────────────────────────────────────────────────

// GET the active relief catalogue (codes, labels, caps) for a Year of Assessment.
// Used to build the calculator form dynamically.
export const getReliefs = async (ya = 2025) => {
  const response = await axios.get(`${API_URL}/api/v1/tax/reliefs`, { params: { ya } });
  return response.data;
};

// POST income + relief claims, get back the full calculation breakdown.
//   payload: { total_income, reliefs: { code: amount, ... }, zakat, year_of_assessment }
export const calculateTax = async (payload) => {
  const response = await axios.post(`${API_URL}/api/v1/tax/calculate`, payload);
  return response.data;
};
