import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import axios from 'axios';
import api from '../lib/api';
import type { AuthTokens, JwtPayload } from '@voice/shared';

interface AuthContext {
  isAuthenticated: boolean;
  isLoading: boolean;
  user: JwtPayload | null;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContext | null>(null);

function parseJwt(token: string): JwtPayload | null {
  try {
    return JSON.parse(atob(token.split('.')[1]));
  } catch {
    return null;
  }
}

function isTokenExpired(payload: JwtPayload | null): boolean {
  if (!payload?.exp) return true;
  return payload.exp * 1000 < Date.now();
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<JwtPayload | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    async function init() {
      try {
        const raw = localStorage.getItem('auth_tokens');
        if (!raw) { setIsLoading(false); return; }

        let parsed: AuthTokens;
        try {
          parsed = JSON.parse(raw) as AuthTokens;
        } catch {
          localStorage.removeItem('auth_tokens');
          setIsLoading(false);
          return;
        }
        const { accessToken, refreshToken } = parsed;
        if (!accessToken || !refreshToken) {
          localStorage.removeItem('auth_tokens');
          setIsLoading(false);
          return;
        }

        const payload = parseJwt(accessToken);
        if (!isTokenExpired(payload)) {
          setUser(payload);
          setIsLoading(false);
          return;
        }

        try {
          const res = await axios.post('/auth/refresh', { refreshToken });
          const tokens = res.data.data as AuthTokens;
          localStorage.setItem('auth_tokens', JSON.stringify(tokens));
          setUser(parseJwt(tokens.accessToken));
        } catch {
          localStorage.removeItem('auth_tokens');
        }
      } catch {
        localStorage.removeItem('auth_tokens');
      }
      setIsLoading(false);
    }
    init();
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const res = await api.post('/auth/login', { email, password });
    const tokens = res.data.data as AuthTokens;
    localStorage.setItem('auth_tokens', JSON.stringify(tokens));
    setUser(parseJwt(tokens.accessToken));
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem('auth_tokens');
    setUser(null);
    window.location.href = '/login';
  }, []);

  return (
    <AuthContext.Provider value={{ isAuthenticated: !!user, isLoading, user, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
