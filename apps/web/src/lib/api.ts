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
    const original = err?.config;
    const isAuthRequest =
      original?.url?.includes('/auth/login') || original?.url?.includes('/auth/refresh');
    if (err.response?.status === 401 && !original?._retry && !isAuthRequest) {
      original._retry = true;
      try {
        const raw = localStorage.getItem('auth_tokens');
        if (!raw) throw new Error('No tokens');
        const { refreshToken } = JSON.parse(raw) as { refreshToken?: string };
        if (!refreshToken) throw new Error('No refresh token');
        const res = await api.post('/auth/refresh', { refreshToken });
        const tokens = res.data.data as { accessToken: string };
        localStorage.setItem('auth_tokens', JSON.stringify(res.data.data));
        original.headers.Authorization = `Bearer ${tokens.accessToken}`;
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
