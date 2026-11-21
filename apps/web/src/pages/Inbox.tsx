import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Api, ApiError, clearPassword } from '../api';
import type { ChannelType, ChatMessage, ConversationListItem } from '../api';
import { useAuth } from '../auth';
import { careWindowHoursRemaining, clockTime, dayLabel, timeAgo, useInterval } from '../hooks';
import {
  IconAlert,
  IconBot,
  IconCheck,
  IconCheckDouble,
  IconChevronLeft,
  IconClock,
  IconInbox,
  IconRefresh,
  IconSend,
  IconUserCheck
} from '../icons';
import { useToast } from '../toast';
import { Avatar, BackButton, CHANNEL_LABEL, ChannelIcon, EmptyState, ErrorBanner, LoadingBlock, PageHeader } from '../ui';

type HandoverFilter = 'all' | 'needs_human';

function HandoverBadge({ state }: { state: ConversationListItem['handover_state'] }) {
  if (state === 'human_requested') {
    return (
      <span className="badge badge-urgent">
        <span className="pulse-dot" /> Needs human
      </span>
    );
  }
  if (state === 'human_assigned') {
    return (
      <span className="badge badge-primary">
        <IconUserCheck /> Handled by staff
      </span>
    );
  }
  return (
    <span className="badge badge-neutral">
      <IconBot /> Auto mode
    </span>
  );
}

function Ticks({ status }: { status: ChatMessage['delivery_status'] }) {
  if (status === 'simulated') return <span className="sim-chip">Simulated</span>;
  if (status === 'pending') return <IconClock />;
  if (status === 'failed') return <span className="failed-label">Failed</span>;
  if (status === 'sent') return <IconCheckDouble className="tick-sent" />;
  if (status === 'delivered') return <IconCheckDouble className="tick-sent" />;
  if (status === 'read') return <IconCheckDouble className="tick-read" />;
  return null;
}

export function Inbox() {
  const { conversationId } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { logout } = useAuth();

  const [conversations, setConversations] = useState<ConversationListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [handoverFilter, setHandoverFilter] = useState<HandoverFilter>('all');
  const [channelFilter, setChannelFilter] = useState<'all' | ChannelType>('all');
  const [search, setSearch] = useState('');

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [threadLoading, setThreadLoading] = useState(false);
  const [replyText, setReplyText] = useState('');
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const needsHumanCount = useMemo(
    () => conversations.filter((c) => c.handover_state === 'human_requested').length,
    [conversations]
  );

  const loadList = useCallback(async () => {
    try {
      const res = await Api.listConversations();
      setConversations(res.conversations);
      setError(null);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        clearPassword();
        logout();
        navigate('/login');
        return;
      }
      setError(err instanceof ApiError ? err.message : 'Could not load conversations.');
    } finally {
      setLoading(false);
    }
  }, [logout, navigate]);

  const loadThread = useCallback(async (id: string) => {
    setThreadLoading(true);
    try {
      const res = await Api.listMessages(id);
      setMessages(res.messages);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Could not load messages.');
    } finally {
      setThreadLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    void loadList();
  }, [loadList]);

  useEffect(() => {
    if (conversationId) {
      void loadThread(conversationId);
      const conv = conversations.find((c) => c.id === conversationId);
      if (conv && conv.unread_count > 0) {
        void Api.markRead(conversationId).then(() => loadList()).catch(() => undefined);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId]);

  useInterval(loadList, 20000);
  useInterval(
    () => {
      if (conversationId) void loadThread(conversationId);
    },
    conversationId ? 15000 : null
  );

  // Auto-scroll to latest message
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, conversationId]);

  const selected = conversations.find((c) => c.id === conversationId) || null;

  const filtered = useMemo(() => {
    let list = [...conversations];
    if (handoverFilter === 'needs_human') list = list.filter((c) => c.handover_state === 'human_requested');
    if (channelFilter !== 'all') list = list.filter((c) => c.channel_type === channelFilter);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter(
        (c) =>
          (c.display_name || '').toLowerCase().includes(q) ||
          (c.phone_number_masked || '').toLowerCase().includes(q) ||
          (c.last_message_preview || '').toLowerCase().includes(q)
      );
    }
    // Needs-human conversations float to the top of the queue
    list.sort((a, b) => {
      const aUrgent = a.handover_state === 'human_requested' ? 1 : 0;
      const bUrgent = b.handover_state === 'human_requested' ? 1 : 0;
      if (aUrgent !== bUrgent) return bUrgent - aUrgent;
      return (b.updated_at || '').localeCompare(a.updated_at || '');
    });
    return list;
  }, [conversations, handoverFilter, channelFilter, search]);

  const send = async () => {
    const text = replyText.trim();
    if (!text || !conversationId || sending) return;
    setSending(true);
    try {
      await Api.sendReply(conversationId, text);
      setReplyText('');
      await loadThread(conversationId);
      await loadList();
      toast.success('Reply sent');
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Could not send the reply.');
    } finally {
      setSending(false);
    }
  };

  const setHandover = async (state: 'bot' | 'human_requested' | 'human_assigned') => {
    if (!conversationId) return;
    try {
      await Api.setHandover(conversationId, state);
      await loadList();
      toast.success(
        state === 'bot' ? 'Automation resumed for this chat' : state === 'human_assigned' ? 'You are now handling this chat' : 'Human help requested'
      );
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Could not change handover state.');
    }
  };

  const careHours = selected ? careWindowHoursRemaining(selected.last_customer_message_at) : null;

  const onComposerKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  };

  /* ---------- Thread (used on desktop right pane and mobile full view) ---------- */
  const thread = selected && (
    <div className="thread-pane">
      <div className="thread-head">
        <BackButton onClick={() => navigate('/inbox')} />
        <Avatar name={selected.display_name || selected.phone_number_masked || 'Customer'} seed={selected.id} miniChannel={selected.channel_type} />
        <div className="thread-head-info">
          <div className="thread-head-name">
            {selected.display_name || selected.phone_number_masked || 'Customer'}
          </div>
          <div className="thread-head-sub">
            {selected.phone_number_masked || CHANNEL_LABEL[selected.channel_type]} · via {selected.account_name}
          </div>
        </div>
        <div className="thread-actions">
          {selected.handover_state === 'bot' && (
            <button className="btn btn-soft btn-sm" onClick={() => void setHandover('human_assigned')}>
              <IconUserCheck /> Take over
            </button>
          )}
          {selected.handover_state === 'human_requested' && (
            <button className="btn btn-primary btn-sm" onClick={() => void setHandover('human_assigned')}>
              <IconUserCheck /> Assign to me
            </button>
          )}
          {selected.handover_state === 'human_assigned' && (
            <button className="btn btn-soft btn-sm" onClick={() => void setHandover('bot')}>
              <IconBot /> Return to auto mode
            </button>
          )}
        </div>
      </div>

      <div className="thread-messages" ref={scrollRef}>
        {threadLoading && messages.length === 0 ? (
          <LoadingBlock label="Loading messages…" />
        ) : messages.length === 0 ? (
          <div className="empty-state" style={{ padding: 24 }}>
            <div className="empty-title">No messages yet</div>
            <div className="empty-sub">Messages will appear here as customers reach out.</div>
          </div>
        ) : (
          messages.map((m, idx) => {
            const prev = messages[idx - 1];
            const showDay = !prev || dayLabel(prev.created_at) !== dayLabel(m.created_at);
            const out = m.direction === 'outbound';
            const simulated = m.is_simulated === 1;
            const senderLabel =
              m.sender_type === 'customer' ? 'Customer' : m.sender_type === 'bot' ? 'OmniFlow auto-reply' : 'You (staff)';
            return (
              <div key={m.id}>
                {showDay && <div className="day-divider">{dayLabel(m.created_at)}</div>}
                <div className={`msg-row ${out ? 'out' : 'in'}`}>
                  <div className="msg-sender">
                    {m.sender_type === 'bot' ? <span className="role-tag">{senderLabel}</span> : senderLabel}
                  </div>
                  <div className={`bubble${simulated ? ' simulated' : ''}`}>{m.body || ''}</div>
                  <div className="msg-meta">
                    <span>{clockTime(m.created_at)}</span>
                    {out && <Ticks status={m.delivery_status} />}
                  </div>
                  {m.delivery_status === 'failed' && m.error_message && (
                    <div className="msg-error">
                      <IconAlert width={12} height={12} style={{ verticalAlign: -2, marginRight: 4 }} />
                      {m.error_message}
                    </div>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      {careHours !== null ? (
        <div className="care-banner open">
          <IconCheck />
          <span>24-hour care window open — about {Math.floor(careHours)}h remaining for free-form replies.</span>
        </div>
      ) : (
        <div className="care-banner closed">
          <IconAlert />
          <span>
            24-hour care window is closed. New customer messages will arrive, but Meta only allows approved template
            messages until the customer writes again.
          </span>
        </div>
      )}

      <div className="composer">
        <textarea
          className="textarea"
          placeholder="Type a reply as staff… (Enter to send, Shift+Enter for a new line)"
          value={replyText}
          onChange={(e) => setReplyText(e.target.value)}
          onKeyDown={onComposerKey}
          rows={1}
          aria-label="Reply message"
        />
        <button className="send-btn" onClick={() => void send()} disabled={sending || !replyText.trim()} aria-label="Send reply">
          {sending ? <span className="spinner spinner-sm" style={{ borderTopColor: '#fff', borderColor: 'rgba(255,255,255,0.4)' }} /> : <IconSend />}
        </button>
      </div>
    </div>
  );

  return (
    <>
      <PageHeader
        title="Inbox"
        subtitle="Customer conversations across all your channels."
        actions={
          <button className="btn btn-soft btn-sm" onClick={() => void loadList()}>
            <IconRefresh /> Refresh
          </button>
        }
      />

      {error && <ErrorBanner text={error} />}

      <div className={`inbox-layout ${conversationId ? 'thread-open-mobile' : ''}`}>
        <div className="inbox-list">
          <div className="inbox-list-head">
            <div className="filter-bar" style={{ marginBottom: 0 }}>
              <button
                className={`filter-pill ${handoverFilter === 'all' ? 'active' : ''}`}
                onClick={() => setHandoverFilter('all')}
              >
                All chats
              </button>
              <button
                className={`filter-pill ${handoverFilter === 'needs_human' ? 'active' : ''}`}
                onClick={() => setHandoverFilter('needs_human')}
              >
                Needs human
                {needsHumanCount > 0 && <span className="pill-count">{needsHumanCount}</span>}
              </button>
            </div>
            <div className="filter-bar" style={{ marginBottom: 0 }}>
              <div className="search-input">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="11" cy="11" r="8" />
                  <path d="m21 21-4.3-4.3" />
                </svg>
                <input
                  className="input"
                  placeholder="Search name or message…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  aria-label="Search conversations"
                />
              </div>
              <button className={`filter-pill ${channelFilter === 'all' ? 'active' : ''}`} onClick={() => setChannelFilter('all')}>
                All
              </button>
              {(['whatsapp', 'instagram', 'messenger'] as ChannelType[]).map((ch) => (
                <button
                  key={ch}
                  className={`filter-pill ${channelFilter === ch ? 'active' : ''}`}
                  onClick={() => setChannelFilter(ch)}
                  title={CHANNEL_LABEL[ch]}
                >
                  <ChannelIcon channel={ch} />
                </button>
              ))}
            </div>
          </div>

          <div className="inbox-list-scroll">
            {loading ? (
              <LoadingBlock label="Loading conversations…" />
            ) : filtered.length === 0 ? (
              <EmptyState
                icon={<IconInbox />}
                title={conversations.length === 0 ? 'Your inbox is calm' : 'No chats match this filter'}
                sub={
                  conversations.length === 0
                    ? 'Once a customer messages one of your connected channels, the conversation appears here.'
                    : 'Try a different search, channel or handover filter.'
                }
              />
            ) : (
              filtered.map((c) => (
                <button
                  key={c.id}
                  className={`conv-item ${c.id === conversationId ? 'selected' : ''}`}
                  onClick={() => navigate(`/inbox/${c.id}`)}
                >
                  <Avatar name={c.display_name || c.phone_number_masked || 'Customer'} seed={c.id} miniChannel={c.channel_type} />
                  <div className="list-row-body">
                    <div className="row-title">
                      {c.display_name || c.phone_number_masked || 'Customer'}
                      {c.handover_state === 'human_requested' && <span className="pulse-dot" />}
                    </div>
                    <div className="row-sub">{c.last_message_preview || 'No message preview'}</div>
                  </div>
                  <div className="row-side">
                    <span className="row-time">{timeAgo(c.updated_at)}</span>
                    {c.unread_count > 0 ? <span className="unread-pill">{c.unread_count}</span> : <HandoverBadge state={c.handover_state} />}
                  </div>
                </button>
              ))
            )}
          </div>
        </div>

        <div className={conversationId ? '' : 'hidden-mobile'}>
          {selected ? (
            thread
          ) : (
            <div className="thread-pane" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <div className="empty-state">
                <span className="empty-icon">
                  <IconInbox />
                </span>
                <div className="empty-title">Select a conversation</div>
                <div className="empty-sub">Pick a chat from the list to read messages and reply as staff.</div>
                <button className="btn btn-ghost btn-sm back-btn" onClick={() => navigate('/inbox')}>
                  <IconChevronLeft /> Back to list
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      <style>{`
        @media (max-width: 899.5px) {
          .inbox-layout.thread-open-mobile .inbox-list { display: none; }
          .inbox-layout:not(.thread-open-mobile) .thread-pane { display: none; }
        }
      `}</style>
    </>
  );
}
