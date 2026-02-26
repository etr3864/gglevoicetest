import axios from 'axios';

const baseURL = import.meta.env.VITE_API_URL || '/';
const api = axios.create({ baseURL });

api.interceptors.request.use((config) => {
  const tokens = localStorage.getItem('auth_tokens');
  if (tokens) {
    const { accessToken } = JSON.parse(tokens);
    config.headers.Authorization = `Bearer ${accessToken}`;
  }
  return config;
});

api.interceptors.response.use(
  (res) => res,
  async (err) => {
    const original = err.config;
    if (err.response?.status === 401 && !original._retry) {
      original._retry = true;
      try {
        const tokens = localStorage.getItem('auth_tokens');
        if (!tokens) throw new Error('No tokens');
        const { refreshToken } = JSON.parse(tokens);
        const res = await api.post('/auth/refresh', { refreshToken });
        localStorage.setItem('auth_tokens', JSON.stringify(res.data.data));
        original.headers.Authorization = `Bearer ${res.data.data.accessToken}`;
        return api(original);
      } catch {
        localStorage.removeItem('auth_tokens');
        window.location.href = '/login';
      }
    }
    return Promise.reject(err);
  }
);

export default api;
