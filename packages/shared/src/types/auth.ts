export interface LoginBody {
  email: string;
  password: string;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

export interface JwtPayload {
  userId: string;
  email: string;
  role: UserRole;
  isActive: boolean;
  parentId: string | null;
  exp?: number;
  iat?: number;
}

export type UserRole = 'super_admin' | 'admin' | 'employee';

export interface AuthUser {
  id: string;
  email: string;
  role: UserRole;
  name: string | null;
  companyName: string | null;
  phone: string | null;
  isActive: boolean;
  parentId: string | null;
  createdAt: string;
}
