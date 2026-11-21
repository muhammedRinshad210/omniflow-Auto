import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { ApiError } from '../api';
import { useAuth } from '../auth';
import { BrandMark, IconEye, IconEyeOff, IconInbox } from '../icons';

export function Login() {
  const { login, serverConfigured, authed } = useAuth();
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // After a successful login the authed flag flips — send the user to the dashboard
  useEffect(() => {
    if (authed) navigate('/', { replace: true });
  }, [authed, navigate]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!password.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      await login(password.trim());
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Login failed. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-wrap">
      <div className="login-card">
        <div className="login-brand">
          <BrandMark className="brand-mark" />
          <h1 className="login-title">OmniFlow</h1>
          <p className="login-sub">
            WhatsApp, Instagram &amp; Messenger automation for your business — one calm inbox, automatic replies, human
            handover.
          </p>
        </div>

        <form onSubmit={submit}>
          <div className="field">
            <label className="label" htmlFor="admin-password">
              Admin password
            </label>
            <div className="input-wrap">
              <input
                id="admin-password"
                className="input"
                type={showPw ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter the dashboard password"
                autoComplete="current-password"
                autoFocus
              />
              <button
                type="button"
                className="input-affix icon-btn"
                onClick={() => setShowPw((v) => !v)}
                aria-label={showPw ? 'Hide password' : 'Show password'}
                style={{ width: 36, height: 36 }}
              >
                {showPw ? <IconEyeOff /> : <IconEye />}
              </button>
            </div>
          </div>

          {error && (
            <div className="error-banner" role="alert">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" width={18} height={18} style={{ flexShrink: 0, marginTop: 1 }}>
                <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                <path d="M12 9v4" />
                <path d="M12 17h.01" />
              </svg>
              <span>{error}</span>
            </div>
          )}

          {serverConfigured === false && !error && (
            <div className="info-banner">
              <span>
                <strong>Server setup needed:</strong> the <code>ADMIN_PASSWORD</code> secret is not configured yet. On
                your machine run <code>wrangler secret put ADMIN_PASSWORD</code> (or add it to{' '}
                <code>apps/api/.dev.vars</code> locally), then reload this page.
              </span>
            </div>
          )}

          <button className="btn btn-primary btn-block" type="submit" disabled={busy || !password.trim()}>
            {busy ? <span className="spinner spinner-sm" style={{ borderTopColor: '#fff', borderColor: 'rgba(255,255,255,0.4)' }} /> : 'Sign in'}
          </button>
        </form>

        <p className="login-note">
          The password is set on the server with <code>wrangler secret put ADMIN_PASSWORD</code> and is never stored in
          code or this browser beyond the current tab session.
        </p>
        <div style={{ display: 'flex', justifyContent: 'center', marginTop: 14, color: 'var(--color-text-faint)' }}>
          <IconInbox width={20} height={20} />
        </div>
      </div>
    </div>
  );
}
