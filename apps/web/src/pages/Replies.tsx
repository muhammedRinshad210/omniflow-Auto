import { useCallback, useEffect, useMemo, useState } from 'react';
import { Api, ApiError } from '../api';
import type { AutomationRule, ChannelType } from '../api';
import { useInterval } from '../hooks';
import { IconAlert, IconBolt, IconCheck, IconEdit, IconPlus, IconRefresh, IconTrash, IconX } from '../icons';
import { useToast } from '../toast';
import { EmptyState, ErrorBanner, LoadingBlock, Modal, PageHeader } from '../ui';

const MATCH_LABELS: Record<string, string> = {
  contains: 'Contains',
  exact: 'Exact match',
  starts_with: 'Starts with'
};

const MATCH_HINTS: Record<string, string> = {
  contains: 'Replies when the message contains the keyword anywhere (recommended — forgiving for typos).',
  exact: 'Replies only when the whole message equals the keyword. Good for short commands like "hi".',
  starts_with: 'Replies when the message starts with the keyword.'
};

interface RuleForm {
  name: string;
  channel: ChannelType;
  isFallback: boolean;
  keywords: string[];
  match: string;
  en: string;
  ml: string;
  priority: number;
  active: boolean;
}

function ruleToForm(r: AutomationRule): RuleForm {
  let keywords: string[] = [];
  let match = 'contains';
  try {
    const cfg = JSON.parse(r.trigger_config_json);
    if (Array.isArray(cfg)) {
      keywords = cfg;
      match = r.trigger_type === 'keyword_exact' ? 'exact' : r.trigger_type === 'keyword_starts_with' ? 'starts_with' : 'contains';
    } else if (cfg && typeof cfg === 'object') {
      keywords = Array.isArray(cfg.keywords) ? cfg.keywords : [];
      match = cfg.match || 'contains';
    }
  } catch {
    /* keep defaults */
  }
  let en = '';
  let ml = '';
  try {
    const content = JSON.parse(r.response_content_json);
    en = typeof content.en === 'string' ? content.en : '';
    ml = typeof content.ml === 'string' ? content.ml : '';
  } catch {
    /* keep defaults */
  }
  return {
    name: r.name,
    channel: (r.channel_type as ChannelType) || 'whatsapp',
    isFallback: r.trigger_type === 'default_fallback',
    keywords,
    match,
    en,
    ml,
    priority: r.priority,
    active: r.is_active === 1
  };
}

const EMPTY_FORM: RuleForm = {
  name: '',
  channel: 'whatsapp',
  isFallback: false,
  keywords: [],
  match: 'contains',
  en: '',
  ml: '',
  priority: 10,
  active: true
};

function validate(form: RuleForm): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!form.name.trim()) errors.name = 'Give the rule a short name.';
  if (!form.isFallback && form.keywords.length === 0) errors.keywords = 'Add at least one keyword.';
  if (!form.en.trim() && !form.ml.trim()) errors.replies = 'Write the reply in English, Malayalam or both.';
  const p = Number(form.priority);
  if (!Number.isInteger(p) || p < 0 || p > 1000) errors.priority = 'Priority must be 0–1000.';
  return errors;
}

function KeywordChipsEditor({
  keywords,
  onChange,
  error
}: {
  keywords: string[];
  onChange: (next: string[]) => void;
  error?: string;
}) {
  const [draft, setDraft] = useState('');

  const add = () => {
    const kw = draft.trim();
    if (!kw) return;
    if (keywords.includes(kw)) {
      setDraft('');
      return;
    }
    onChange([...keywords, kw]);
    setDraft('');
  };

  return (
    <>
      <div className="kw-editor" onClick={(e) => (e.currentTarget.querySelector('input') as HTMLInputElement)?.focus()}>
        {keywords.map((kw) => (
          <span key={kw} className="chip">
            {kw}
            <button type="button" aria-label={`Remove ${kw}`} onClick={() => onChange(keywords.filter((k) => k !== kw))}>
              <IconX />
            </button>
          </span>
        ))}
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ',') {
              e.preventDefault();
              add();
            } else if (e.key === 'Backspace' && !draft && keywords.length > 0) {
              onChange(keywords.slice(0, -1));
            }
          }}
          onBlur={add}
          placeholder={keywords.length === 0 ? 'Type a keyword and press Enter…' : 'Add another…'}
          aria-label="Add keyword"
        />
      </div>
      {error && <div className="field-error">{error}</div>}
    </>
  );
}

function RuleEditor({
  editing,
  existing,
  onClose,
  onSaved
}: {
  editing: boolean;
  existing: AutomationRule | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [form, setForm] = useState<RuleForm>(existing ? ruleToForm(existing) : EMPTY_FORM);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const set = <K extends keyof RuleForm>(key: K, value: RuleForm[K]) => setForm((f) => ({ ...f, [key]: value }));

  const submit = async () => {
    const errs = validate(form);
    setErrors(errs);
    if (Object.keys(errs).length > 0) return;
    setBusy(true);
    try {
      const payload = {
        name: form.name.trim(),
        channel_type: form.channel,
        trigger_type: form.isFallback ? 'default_fallback' : 'keyword',
        trigger_config_json: form.isFallback ? [] : { keywords: form.keywords, match: form.match },
        response_content_json: {
          ...(form.en.trim() ? { en: form.en.trim() } : {}),
          ...(form.ml.trim() ? { ml: form.ml.trim() } : {})
        },
        priority: Number(form.priority),
        is_active: form.active ? 1 : 0
      };
      if (editing && existing) {
        await Api.updateRule(existing.id, payload);
        toast.success('Reply rule updated');
      } else {
        await Api.createRule(payload);
        toast.success('Reply rule created');
      }
      onSaved();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Could not save the rule.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={editing ? 'Edit reply rule' : 'New reply rule'}
      onClose={onClose}
      wide
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={() => void submit()} disabled={busy}>
            {busy ? <span className="spinner spinner-sm" style={{ borderTopColor: '#fff', borderColor: 'rgba(255,255,255,0.4)' }} /> : <IconCheck />}
            {editing ? 'Save changes' : 'Create rule'}
          </button>
        </>
      }
    >
      <div className="field">
        <label className="label">
          Rule name <span className="optional">visible only to staff</span>
        </label>
        <input
          className="input"
          value={form.name}
          onChange={(e) => set('name', e.target.value)}
          placeholder="e.g. Pricing enquiry"
          maxLength={100}
        />
        {errors.name && <div className="field-error">{errors.name}</div>}
      </div>

      <div className="field">
        <label className="label">Channel</label>
        <div className="form-row" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
          {(['whatsapp', 'instagram', 'messenger'] as ChannelType[]).map((ch) => (
            <button
              key={ch}
              type="button"
              className={`mode-card ${form.channel === ch ? 'selected' : ''}`}
              onClick={() => set('channel', ch)}
              style={{ padding: 10, alignItems: 'center', flexDirection: 'row' }}
            >
              <span className="mode-name" style={{ fontSize: 13.5 }}>{ch === 'whatsapp' ? 'WhatsApp' : ch === 'instagram' ? 'Instagram' : 'Messenger'}</span>
            </button>
          ))}
        </div>
        <div className="field-hint">The rule only runs for messages on this channel.</div>
      </div>

      <div className="field">
        <label className="label">Trigger</label>
        <div className="form-row">
          <button type="button" className={`mode-card ${!form.isFallback ? 'selected' : ''}`} onClick={() => set('isFallback', false)}>
            <span className="mode-name"><IconBolt width={15} height={15} /> Keyword match</span>
            <span className="mode-desc">Reply when a customer message matches your keywords.</span>
          </button>
          <button type="button" className={`mode-card ${form.isFallback ? 'selected' : ''}`} onClick={() => set('isFallback', true)}>
            <span className="mode-name"><IconAlert width={15} height={15} /> Default fallback</span>
            <span className="mode-desc">Reply when no keyword rule matched. Keep only one fallback per channel.</span>
          </button>
        </div>
      </div>

      {!form.isFallback && (
        <>
          <div className="field">
            <label className="label">
              Keywords <span className="optional">English &amp; Malayalam</span>
            </label>
            <KeywordChipsEditor keywords={form.keywords} onChange={(kw) => set('keywords', kw)} error={errors.keywords} />
          </div>
          <div className="field">
            <label className="label">Matching style</label>
            <select className="select" value={form.match} onChange={(e) => set('match', e.target.value)}>
              <option value="contains">Contains the keyword</option>
              <option value="exact">Exact match only</option>
              <option value="starts_with">Message starts with the keyword</option>
            </select>
            <div className="field-hint">{MATCH_HINTS[form.match]}</div>
          </div>
        </>
      )}

      <div className="field">
        <label className="label">Automatic reply</label>
        <div className="reply-lang-block">
          <div className="reply-lang-head">
            <span className="lang-flag">EN</span> English reply
          </div>
          <textarea
            className="textarea"
            style={{ minHeight: 66 }}
            value={form.en}
            onChange={(e) => set('en', e.target.value)}
            placeholder="Hello! Thanks for reaching out. How can we help you today?"
            maxLength={3500}
          />
        </div>
        <div className="reply-lang-block" style={{ marginBottom: 0 }}>
          <div className="reply-lang-head">
            <span className="lang-flag">ML</span> Malayalam reply
          </div>
          <textarea
            className="textarea"
            style={{ minHeight: 66 }}
            value={form.ml}
            onChange={(e) => set('ml', e.target.value)}
            placeholder="നമസ്കാരം! എങ്ങനെ സഹായിക്കാനാകും?"
            maxLength={3500}
          />
        </div>
        {errors.replies && <div className="field-error">{errors.replies}</div>}
        <div className="field-hint">
          Malayalam-speaking customers get the Malayalam reply; others get English. At least one language is required.
        </div>
      </div>

      <div className="form-row">
        <div className="field">
          <label className="label">Priority</label>
          <input
            className="input"
            type="number"
            min={0}
            max={1000}
            value={form.priority}
            onChange={(e) => set('priority', Number(e.target.value))}
          />
          {errors.priority && <div className="field-error">{errors.priority}</div>}
          <div className="field-hint">Higher numbers are checked first (0–1000).</div>
        </div>
        <div className="field">
          <label className="label">Status</label>
          <label className="switch" style={{ marginTop: 10 }}>
            <input type="checkbox" checked={form.active} onChange={(e) => set('active', e.target.checked)} />
            <span className="switch-track" />
            <span className="switch-label">{form.active ? 'Active' : 'Paused'}</span>
          </label>
        </div>
      </div>
    </Modal>
  );
}

export function Replies() {
  const toast = useToast();
  const [rules, setRules] = useState<AutomationRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingRule, setEditingRule] = useState<AutomationRule | null>(null);
  const [deleting, setDeleting] = useState<AutomationRule | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await Api.listRules();
      setRules(res.rules);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load rules.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useInterval(load, 45000);

  const sorted = useMemo(() => [...rules].sort((a, b) => b.priority - a.priority), [rules]);

  const parsed = useCallback((r: AutomationRule) => {
    let keywords: string[] = [];
    let match = 'contains';
    try {
      const cfg = JSON.parse(r.trigger_config_json);
      if (Array.isArray(cfg)) {
        keywords = cfg;
        match = r.trigger_type === 'keyword_exact' ? 'exact' : r.trigger_type === 'keyword_starts_with' ? 'starts_with' : 'contains';
      } else if (cfg && typeof cfg === 'object') {
        keywords = Array.isArray(cfg.keywords) ? cfg.keywords : [];
        match = cfg.match || 'contains';
      }
    } catch {
      /* ignore */
    }
    let en = '';
    let ml = '';
    try {
      const content = JSON.parse(r.response_content_json);
      en = typeof content.en === 'string' ? content.en : '';
      ml = typeof content.ml === 'string' ? content.ml : '';
    } catch {
      /* ignore */
    }
    return { keywords, match, en, ml };
  }, []);

  const toggleActive = async (r: AutomationRule) => {
    const { keywords, match, en, ml } = parsed(r);
    const content: Record<string, string> = {};
    if (en) content.en = en;
    if (ml) content.ml = ml;
    try {
      await Api.updateRule(r.id, {
        name: r.name,
        channel_type: r.channel_type,
        trigger_type: r.trigger_type,
        trigger_config_json: r.trigger_type === 'default_fallback' ? [] : { keywords, match },
        response_content_json: content,
        priority: r.priority,
        is_active: r.is_active === 1 ? 0 : 1
      });
      toast.success(r.is_active === 1 ? 'Rule paused' : 'Rule activated');
      await load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Could not update the rule.');
    }
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    try {
      await Api.deleteRule(deleting.id);
      toast.success('Rule deleted');
      setDeleting(null);
      await load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Could not delete the rule.');
    }
  };

  return (
    <>
      <PageHeader
        title="Automatic Replies"
        subtitle="Keyword rules that answer customers instantly — in English and Malayalam."
        actions={
          <>
            <button className="btn btn-soft btn-sm" onClick={() => void load()}>
              <IconRefresh /> Refresh
            </button>
            <button
              className="btn btn-primary btn-sm"
              onClick={() => {
                setEditingRule(null);
                setEditorOpen(true);
              }}
            >
              <IconPlus /> New rule
            </button>
          </>
        }
      />

      {error && <ErrorBanner text={error} />}

      <div className="info-banner">
        <span>
          Rules are checked from the highest priority first, and the first keyword match wins. The fallback reply is
          used only when no keyword matched. Automation must be turned on in <strong>Settings</strong> (Test or Live
          mode) for replies to fire.
        </span>
      </div>

      {loading ? (
        <LoadingBlock />
      ) : sorted.length === 0 ? (
        <div className="card">
          <EmptyState
            icon={<IconBolt />}
            title="No reply rules yet"
            sub="Create your first keyword rule — for example, customers who send “price” or “വില” instantly receive your pricing message."
            action={
              <button className="btn btn-primary" onClick={() => setEditorOpen(true)}>
                <IconPlus /> Create first rule
              </button>
            }
          />
        </div>
      ) : (
        sorted.map((r) => {
          const { keywords, match, en, ml } = parsed(r);
          const isFallback = r.trigger_type === 'default_fallback';
          return (
            <div key={r.id} className="rule-card" style={{ opacity: r.is_active === 1 ? 1 : 0.62 }}>
              <div className="rule-card-head">
                <div className="rule-name">{r.name}</div>
                <div className="rule-actions">
                  <button
                    className="icon-btn"
                    aria-label={`Edit ${r.name}`}
                    onClick={() => {
                      setEditingRule(r);
                      setEditorOpen(true);
                    }}
                  >
                    <IconEdit />
                  </button>
                  <button className="icon-btn danger" aria-label={`Delete ${r.name}`} onClick={() => setDeleting(r)}>
                    <IconTrash />
                  </button>
                </div>
              </div>

              <div className="rule-meta">
                <span className="badge badge-primary">{r.channel_type === 'messenger' ? 'Messenger' : r.channel_type === 'instagram' ? 'Instagram' : 'WhatsApp'}</span>
                {isFallback ? (
                  <span className="badge badge-gold">Fallback</span>
                ) : (
                  <span className="badge badge-outline">{MATCH_LABELS[match] || match}</span>
                )}
                <span className="priority-pill">Priority {r.priority}</span>
                <label className="switch" style={{ marginLeft: 'auto' }} aria-label="Toggle rule">
                  <input type="checkbox" checked={r.is_active === 1} onChange={() => void toggleActive(r)} />
                  <span className="switch-track" />
                  <span className="switch-label" style={{ fontSize: 13 }}>{r.is_active === 1 ? 'Active' : 'Paused'}</span>
                </label>
              </div>

              {!isFallback && keywords.length > 0 && (
                <div className="rule-meta">
                  {keywords.map((k) => (
                    <span key={k} className="chip chip-plain">
                      {k}
                    </span>
                  ))}
                </div>
              )}

              {(en || ml) && (
                <div className="rule-replies">
                  {en && (
                    <div className="reply-preview">
                      <span className="rp-lang">EN</span>
                      <span>{en}</span>
                    </div>
                  )}
                  {ml && (
                    <div className="reply-preview">
                      <span className="rp-lang">ML</span>
                      <span>{ml}</span>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })
      )}

      {editorOpen && (
        <RuleEditor
          editing={!!editingRule}
          existing={editingRule}
          onClose={() => setEditorOpen(false)}
          onSaved={() => {
            setEditorOpen(false);
            void load();
          }}
        />
      )}

      {deleting && (
        <Modal
          title="Delete this rule?"
          onClose={() => setDeleting(null)}
          footer={
            <>
              <button className="btn btn-ghost" onClick={() => setDeleting(null)}>
                Cancel
              </button>
              <button className="btn btn-danger" onClick={() => void confirmDelete()}>
                <IconTrash /> Delete rule
              </button>
            </>
          }
        >
          <p style={{ marginTop: 0 }}>
            <strong>{deleting.name}</strong> will stop replying immediately and be removed permanently.
          </p>
        </Modal>
      )}
    </>
  );
}
