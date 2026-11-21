import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Api, ApiError } from '../api';
import type { ContactItem } from '../api';
import { useAuth } from '../auth';
import { timeAgo, useInterval } from '../hooks';
import { IconPeople, IconRefresh, IconSearch } from '../icons';
import { Avatar, CHANNEL_LABEL, ChannelIcon, EmptyState, ErrorBanner, LoadingBlock, PageHeader } from '../ui';

export function Customers() {
  const { logout } = useAuth();
  const navigate = useNavigate();
  const [contacts, setContacts] = useState<ContactItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  const load = useCallback(async () => {
    try {
      const res = await Api.listContacts();
      setContacts(res.contacts);
      setError(null);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        logout();
        navigate('/login');
        return;
      }
      setError(err instanceof ApiError ? err.message : 'Could not load customers.');
    } finally {
      setLoading(false);
    }
  }, [logout, navigate]);

  useEffect(() => {
    void load();
  }, [load]);

  useInterval(load, 60000);

  const filtered = useMemo(() => {
    if (!search.trim()) return contacts;
    const q = search.trim().toLowerCase();
    return contacts.filter(
      (c) =>
        (c.display_name || '').toLowerCase().includes(q) ||
        (c.phone_number_masked || '').toLowerCase().includes(q) ||
        CHANNEL_LABEL[c.channel_type].toLowerCase().includes(q)
    );
  }, [contacts, search]);

  return (
    <>
      <PageHeader
        title="Customers"
        subtitle="Everyone who has messaged your connected channels. Phone numbers and IDs are always masked."
        actions={
          <button className="btn btn-soft btn-sm" onClick={() => void load()}>
            <IconRefresh /> Refresh
          </button>
        }
      />

      {error && <ErrorBanner text={error} />}

      <div className="filter-bar">
        <div className="search-input" style={{ maxWidth: 420 }}>
          <IconSearch />
          <input
            className="input"
            placeholder="Search name, number or channel…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search customers"
          />
        </div>
        <span className="badge badge-neutral">{contacts.length} total</span>
      </div>

      {loading ? (
        <LoadingBlock />
      ) : filtered.length === 0 ? (
        <div className="card">
          <EmptyState
            icon={<IconPeople />}
            title={contacts.length === 0 ? 'No customers yet' : 'No matches'}
            sub={
              contacts.length === 0
                ? 'Customers appear here automatically when they message your connected channels for the first time.'
                : 'Try a different search term.'
            }
          />
        </div>
      ) : (
        <div className="contact-grid">
          {filtered.map((c) => (
            <div key={c.id} className="card" style={{ padding: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
                <Avatar
                  name={c.display_name || c.phone_number_masked || 'Customer'}
                  seed={c.id}
                  miniChannel={c.channel_type}
                />
                <div className="flex-1">
                  <div className="row-title">{c.display_name || c.phone_number_masked || 'Unknown customer'}</div>
                  <div className="row-sub">{c.phone_number_masked || CHANNEL_LABEL[c.channel_type]}</div>
                </div>
                <span className={`channel-icon ${c.channel_type}`}>
                  <ChannelIcon channel={c.channel_type} />
                </span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 13, color: 'var(--color-text-muted)' }}>
                <span className="badge badge-primary">{c.conversation_count} chat{c.conversation_count === 1 ? '' : 's'}</span>
                <span>{c.last_message_at ? `Last message ${timeAgo(c.last_message_at)}` : `Added ${timeAgo(c.created_at)}`}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
