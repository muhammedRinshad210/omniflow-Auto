import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { Api, ApiError, clearPassword, getPassword, setPassword } from './api';

interface AuthState {
  ready: boolean;
  authed: boolean;
  serverConfigured: boolean | null; // null = unknown, false = ADMIN_PASSWORD unset server-side
  appName: string;
  login: (password: string) => Promise<void>;
  logout: () => void;
  refreshConfigState: () => void;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [authed, setAuthed] = useState(false);
  const [serverConfigured, setServerConfigured] = useState<boolean | null>(null);
  const [appName, setAppName] = useState('OmniFlow');

  const check = useCallback(async () => {
    const pw = getPassword();
    if (!pw) {
      setAuthed(false);
      setReady(true);
      return;
    }
    try {
      const res = await Api.session();
      setAppName(res.app || 'OmniFlow');
      setServerConfigured(true);
      setAuthed(true);
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 503) {
          setServerConfigured(false);
          setAuthed(false);
          clearPassword();
        } else if (err.status === 401) {
          setServerConfigured(true);
          setAuthed(false);
          clearPassword();
        } else {
          // Network / server error — keep session but allow retry
          setAuthed(false);
        }
      } else {
        setAuthed(false);
      }
    } finally {
      setReady(true);
    }
  }, []);

  useEffect(() => {
    void check();
  }, [check]);

  const login = useCallback(async (password: string) => {
    setPassword(password);
    try {
      const res = await Api.session();
      setAppName(res.app || 'OmniFlow');
      setServerConfigured(true);
      setAuthed(true);
    } catch (err) {
      clearPassword();
      if (err instanceof ApiError) {
        if (err.status === 503) {
          setServerConfigured(false);
          throw new ApiError(503, 'ADMIN_PASSWORD is not configured on the server yet.');
        }
        if (err.status === 401) {
          throw new ApiError(401, 'Incorrect admin password. Please try again.');
        }
      }
      throw new ApiError(0, 'Could not reach the OmniFlow server. Is the Worker running?');
    }
  }, []);

  const logout = useCallback(() => {
    clearPassword();
    setAuthed(false);
  }, []);

  const value = useMemo<AuthState>(
    () => ({ ready, authed, serverConfigured, appName, login, logout, refreshConfigState: () => void check() }),
    [ready, authed, serverConfigured, appName, login, logout, check]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
