import { useCallback, useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Api, ApiError } from './api';
import { useAuth } from './auth';
import { BrandMark, IconBolt, IconHome, IconInbox, IconLogout, IconPeople, IconPlug, IconSettings } from './icons';
import { useInterval } from './hooks';

interface ShellStats {
  unreadTotal: number;
  needsHuman: number;
}

export function AppShell() {
  const { appName, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [stats, setStats] = useState<ShellStats>({ unreadTotal: 0, needsHuman: 0 });

  const poll = useCallback(async () => {
    try {
      const res = await Api.overview();
      setStats({
        unreadTotal: 0, // unread totals arrive via inbox page; overview drives needs-human
        needsHuman: res.stats.handover_conversations
      });
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) logout();
    }
  }, [logout]);

  useEffect(() => {
    void poll();
  }, [poll, location.pathname]);

  useInterval(poll, 30000);

  const navClass = ({ isActive }: { isActive: boolean }) => `sidebar-link${isActive ? ' active' : ''}`;

  const doLogout = () => {
    logout();
    navigate('/login');
  };

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-brand" onClick={() => navigate('/')} role="button" tabIndex={0}>
          <BrandMark className="brand-mark" />
          <span className="sidebar-brand-name">{appName}</span>
          <span className="sidebar-tag">Pilot</span>
        </div>

        <nav className="sidebar-nav" aria-label="Main navigation">
          <NavLink to="/" end className={navClass}>
            <IconHome /> Dashboard
          </NavLink>
          <NavLink to="/inbox" className={navClass}>
            <IconInbox /> Inbox
            {stats.needsHuman > 0 && <span className="sidebar-badge urgent">{stats.needsHuman}</span>}
          </NavLink>
          <NavLink to="/customers" className={navClass}>
            <IconPeople /> Customers
          </NavLink>
          <NavLink to="/replies" className={navClass}>
            <IconBolt /> Automatic Replies
          </NavLink>
          <NavLink to="/channels" className={navClass}>
            <IconPlug /> Channels
          </NavLink>
          <NavLink to="/settings" className={navClass}>
            <IconSettings /> Settings
          </NavLink>
        </nav>

        <div className="sidebar-footer">
          <div className="sidebar-user">
            <span className="avatar" style={{ width: 30, height: 30, fontSize: 12 }} aria-hidden="true">
              A
            </span>
            <span>
              Admin session
              <br />
              <span style={{ fontSize: 11.5 }}>Password secured server-side</span>
            </span>
          </div>
          <button className="sidebar-link" onClick={doLogout}>
            <IconLogout /> Log out
          </button>
        </div>
      </aside>

      <div className="app-main">
        <header className="mobile-header">
          <BrandMark className="brand-mark" onClick={() => navigate('/')} />
          <span className="mobile-header-title">{appName}</span>
          <span className="spacer" />
          {stats.needsHuman > 0 && (
            <button className="filter-pill" style={{ minHeight: 32 }} onClick={() => navigate('/inbox')}>
              Needs human <span className="pill-count">{stats.needsHuman}</span>
            </button>
          )}
          <button className="icon-btn" onClick={doLogout} aria-label="Log out">
            <IconLogout />
          </button>
        </header>

        <main className="app-content">
          <Outlet />
        </main>

        <nav className="bottom-nav" aria-label="Primary">
          <div className="bottom-nav-inner">
            <NavLink to="/inbox" className={({ isActive }) => `bottom-tab${isActive ? ' active' : ''}`}>
              <IconInbox />
              Inbox
              {stats.needsHuman > 0 && <span className="tab-dot urgent">{stats.needsHuman}</span>}
            </NavLink>
            <NavLink to="/customers" className={({ isActive }) => `bottom-tab${isActive ? ' active' : ''}`}>
              <IconPeople />
              Customers
            </NavLink>
            <NavLink to="/replies" className={({ isActive }) => `bottom-tab${isActive ? ' active' : ''}`}>
              <IconBolt />
              Replies
            </NavLink>
            <NavLink to="/channels" className={({ isActive }) => `bottom-tab${isActive ? ' active' : ''}`}>
              <IconPlug />
              Channels
            </NavLink>
            <NavLink to="/settings" className={({ isActive }) => `bottom-tab${isActive ? ' active' : ''}`}>
              <IconSettings />
              Settings
            </NavLink>
          </div>
        </nav>
      </div>
    </div>
  );
}
