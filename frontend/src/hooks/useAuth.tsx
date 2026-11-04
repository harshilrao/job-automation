import { createContext, useContext, useState, useEffect, ReactNode, useCallback } from 'react';
import { UserProfile } from '@shared/types';
import { api } from '../services/api';

interface AuthContextType {
  user: { userId: string; email: string } | null;
  profile: UserProfile | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (data: { email: string; password: string; firstName: string; lastName: string }) => Promise<void>;
  logout: () => Promise<void>;
  refreshProfile: () => Promise<void>;
  updateProfile: (data: Partial<UserProfile>) => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<{ userId: string; email: string } | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  const loadUser = useCallback(async () => {
    if (!api.isAuthenticated()) {
      setLoading(false);
      return;
    }

    try {
      const userData = await api.getMe();
      setUser({ userId: userData.userId, email: userData.email });

      const profileData = await api.getProfile();
      setProfile(profileData.profile);
    } catch (error) {
      console.error('Failed to load user:', error);
      api.clearTokens();
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadUser();
  }, [loadUser]);

  const login = async (email: string, password: string) => {
    await api.login(email, password);
    await loadUser();
  };

  const register = async (data: { email: string; password: string; firstName: string; lastName: string }) => {
    await api.register(data);
    await loadUser();
  };

  const logout = async () => {
    await api.logout();
    setUser(null);
    setProfile(null);
  };

  const refreshProfile = async () => {
    if (!api.isAuthenticated()) return;
    const profileData = await api.getProfile();
    setProfile(profileData.profile);
  };

  const updateProfile = async (data: Partial<UserProfile>) => {
    if (!api.isAuthenticated()) return;
    await api.updateProfile(data);
    await refreshProfile();
  };

  return (
    <AuthContext.Provider value={{ user, profile, loading, login, register, logout, refreshProfile, updateProfile }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}