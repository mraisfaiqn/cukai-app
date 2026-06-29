import axios from 'axios';

const API_URL = 'http://localhost:8000'

export const test = async () => {
  try {
    const response = await axios.get(`${API_URL}/test`)
    console.log(response.data)
  } catch (error) {
    console.error('Error testing API end-point:', error)
  }
}

// End-point Structure Examples
export const getUsers = async () => {
  const response = await axios.get('https://example.com');
  return response.data;
};

export const createUser = async (userData) => {
  const response = await axios.post('https://example.com', userData);
  return response.data;
};

// frntend mau cakap dgn backend utk login. guna axios utk call backend API.
export const userLogin = async (email, password) => {
  const response = await axios.post(`${API_URL}/userLogin`, {
    email: email,
    password: password
  });
  return response.data;
};