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
    console.log('[useAuth] loadUser started, isAuthenticated:', api.isAuthenticated());
    if (!api.isAuthenticated()) {
      console.log('[useAuth] Not authenticated, setting loading false');
      setLoading(false);
      return;
    }

    try {
      console.log('[useAuth] Calling api.getMe()');
      const userData = await api.getMe();
      console.log('[useAuth] getMe response:', userData);
      setUser({ userId: userData.userId, email: userData.email });

      console.log('[useAuth] Calling api.getProfile()');
      const profileData = await api.getProfile();
      console.log('[useAuth] getProfile response:', profileData);
      setProfile(profileData.profile);
    } catch (error) {
      console.error('[useAuth] Failed to load user:', error);
      api.clearTokens();
    } finally {
      console.log('[useAuth] loadUser finished, setting loading false');
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    console.log('[useAuth] useEffect running loadUser()');
    loadUser();
  }, [loadUser]);

  const login = async (email: string, password: string) => {
    console.log('[useAuth] login called for:', email);
    await api.login(email, password);
    console.log('[useAuth] api.login completed, calling loadUser...');
    await loadUser();
    console.log('[useAuth] loadUser completed, user:', user);
  };

  const register = async (data: { email: string; password: string; firstName: string; lastName: string }) => {
    console.log('[useAuth] register called for:', data.email);
    await api.register(data);
    console.log('[useAuth] api.register completed, calling loadUser...');
    await loadUser();
    console.log('[useAuth] loadUser completed, user:', user);
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