import { useCallback, useEffect, useState } from 'react';
import { Api, ApiError } from '../api';
import type { BusinessHours, TenantSettings } from '../api';
import { useAuth } from '../auth';
import { IconCheck, IconSettings, IconZapOff } from '../icons';
import { useToast } from '../toast';
import { ErrorBanner, LoadingBlock, PageHeader } from '../ui';

interface SettingsForm {
  automation_mode: 'off' | 'test' | 'live';
  dry_run: boolean;
  allowlist: string[];
  default_language: 'en' | 'ml';
  handover_timeout_minutes: number | null;
  businessHours: BusinessHours | null;
  businessHoursOn: boolean;
}

function toForm(s: TenantSettings): SettingsForm {
  let allowlist: string[] = [];
  try {
    const parsed = JSON.parse(s.allowlist_json || '[]');
    if (Array.isArray(parsed)) allowlist = parsed.filter((v) => typeof v === 'string');
  } catch {
    /* keep empty */
  }
  let bh: BusinessHours | null = null;
  if (s.business_hours_json) {
    try {
      const parsed = JSON.parse(s.business_hours_json);
      if (parsed && typeof parsed === 'object') {
        bh = {
          startHour: Number(parsed.startHour ?? 9),
          endHour: Number(parsed.endHour ?? 18),
          timezone: typeof parsed.timezone === 'string' ? parsed.timezone : 'Asia/Kolkata'
        };
      }
    } catch {
      /* keep null */
    }
  }
  return {
    automation_mode: s.automation_mode || 'off',
    dry_run: s.dry_run === 1,
    allowlist,
    default_language: s.default_language === 'en' ? 'en' : 'ml',
    handover_timeout_minutes: s.handover_timeout_minutes ?? null,
    businessHours: bh ?? { startHour: 9, endHour: 18, timezone: 'Asia/Kolkata' },
    businessHoursOn: bh !== null
  };
}

const HANDOVER_OPTIONS: Array<{ value: number | null; label: string }> = [
  { value: null, label: 'Never auto-resume (I resume manually)' },
  { value: 15, label: 'After 15 minutes' },
  { value: 30, label: 'After 30 minutes' },
  { value: 60, label: 'After 1 hour' },
  { value: 120, label: 'After 2 hours' },
  { value: 240, label: 'After 4 hours' },
  { value: 720, label: 'After 12 hours' },
  { value: 1440, label: 'After 24 hours' }
];

export function Settings() {
  const { logout, appName } = useAuth();
  const toast = useToast();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<SettingsForm | null>(null);
  const [allowlistDraft, setAllowlistDraft] = useState('');

  const set = <K extends keyof SettingsForm>(key: K, value: SettingsForm[K]) => {
    setForm((f) => (f ? { ...f, [key]: value } : f));
  };

  const load = useCallback(async () => {
    try {
      const res = await Api.getSettings();
      if (res.settings) {
        const f = toForm(res.settings);
        setForm(f);
        setAllowlistDraft(f.allowlist.join('\n'));
      } else {
        // No settings row yet — present safe defaults; the first save creates it
        setForm({
          automation_mode: 'off',
          dry_run: true,
          allowlist: [],
          default_language: 'ml',
          handover_timeout_minutes: 30,
          businessHours: { startHour: 9, endHour: 18, timezone: 'Asia/Kolkata' },
          businessHoursOn: false
        });
        setAllowlistDraft('');
      }
      setError(null);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        logout();
        return;
      }
      setError(err instanceof ApiError ? err.message : 'Could not load settings.');
    } finally {
      setLoading(false);
    }
  }, [logout]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    if (!form || saving) return;
    setSaving(true);
    try {
      const allowlist = allowlistDraft
        .split(/[\n,]+/)
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      const payload = {
        automation_mode: form.automation_mode,
        dry_run: form.dry_run ? 1 : 0,
        allowlist_json: allowlist,
        default_language: form.default_language,
        handover_timeout_minutes: form.handover_timeout_minutes,
        business_hours_json: form.businessHoursOn
          ? {
              startHour: Number(form.businessHours!.startHour),
              endHour: Number(form.businessHours!.endHour),
              timezone: form.businessHours!.timezone || 'Asia/Kolkata'
            }
          : null
      };
      await Api.putSettings(payload);
      toast.success('Settings saved');
      await load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Could not save settings.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <LoadingBlock />;

  return (
    <>
      <PageHeader
        title="Settings"
        subtitle="Automation safety, business hours and handover behaviour."
        actions={
          <button className="btn btn-primary btn-sm" onClick={() => void save()} disabled={saving || !form}>
            {saving ? <span className="spinner spinner-sm" style={{ borderTopColor: '#fff', borderColor: 'rgba(255,255,255,0.4)' }} /> : <IconCheck />}
            Save all
          </button>
        }
      />

      {error && <ErrorBanner text={error} />}

      {form && (
        <>
          <div className="card mb-16">
            <h2 className="section-title">Automation status</h2>
            <p className="section-hint">
              Controls whether OmniFlow auto-replies to customer messages. This switch applies to every connected
              channel.
            </p>
            <div className="mode-grid">
              <button
                type="button"
                className={`mode-card ${form.automation_mode === 'off' ? 'selected' : ''}`}
                onClick={() => set('automation_mode', 'off')}
              >
                <span className="mode-name"><span className="mode-dot off" /> Off</span>
                <span className="mode-desc">Messages are stored in the inbox, but no automatic replies are sent.</span>
              </button>
              <button
                type="button"
                className={`mode-card ${form.automation_mode === 'test' ? 'selected' : ''}`}
                onClick={() => {
                  set('automation_mode', 'test');
                  set('dry_run', true);
                }}
              >
                <span className="mode-name"><span className="mode-dot test" /> Test</span>
                <span className="mode-desc">Replies are simulated in the inbox — no real message ever reaches a customer. Safe for trying rules.</span>
              </button>
              <button
                type="button"
                className={`mode-card ${form.automation_mode === 'live' ? 'selected' : ''}`}
                onClick={() => {
                  set('automation_mode', 'live');
                  set('dry_run', false);
                }}
              >
                <span className="mode-name"><span className="mode-dot live" /> Live</span>
                <span className="mode-desc">Real replies are delivered to customers. Verify your rules in Test mode first.</span>
              </button>
            </div>

            <div className="settings-row mt-16">
              <div className="sr-body">
                <div className="sr-title">Dry run (never send real messages)</div>
                <div className="sr-desc">
                  Extra safety brake — when enabled, every automated and staff reply is logged as “Simulated” in the
                  inbox instead of being delivered. Recommended until you have verified Meta webhooks and the test
                  number end-to-end.
                </div>
              </div>
              <div className="sr-control">
                <label className="switch">
                  <input type="checkbox" checked={form.dry_run} onChange={(e) => set('dry_run', e.target.checked)} />
                  <span className="switch-track" />
                </label>
              </div>
            </div>

            <div className="settings-row">
              <div className="sr-body">
                <div className="sr-title">Test-mode recipients</div>
                <div className="sr-desc">
                  Phone numbers (one per line, digits only, e.g. 919876543210) that receive replies while in Test mode.
                  Leave empty to simulate replies only in the inbox.
                </div>
                <textarea
                  className="textarea mono"
                  style={{ marginTop: 10, minHeight: 72 }}
                  value={allowlistDraft}
                  onChange={(e) => setAllowlistDraft(e.target.value)}
                  placeholder={'919876543210\n919812345678'}
                />
              </div>
            </div>

            <div className="settings-row">
              <div className="sr-body">
                <div className="sr-title">Preferred language</div>
                <div className="sr-desc">Used when a rule has only one language configured.</div>
              </div>
              <div className="sr-control">
                <select
                  className="select inline-select"
                  value={form.default_language}
                  onChange={(e) => set('default_language', e.target.value === 'en' ? 'en' : 'ml')}
                >
                  <option value="ml">Malayalam</option>
                  <option value="en">English</option>
                </select>
              </div>
            </div>
          </div>

          <div className="card mb-16">
            <h2 className="section-title">Business hours</h2>
            <p className="section-hint">
              Outside these hours, keyword auto-replies pause and the fallback “we will get back to you” behaviour
              applies. Times use the timezone you set.
            </p>

            <div className="settings-row">
              <div className="sr-body">
                <div className="sr-title">Limit auto-replies to business hours</div>
                <div className="sr-desc">When off, rules fire around the clock.</div>
              </div>
              <div className="sr-control">
                <label className="switch">
                  <input type="checkbox" checked={form.businessHoursOn} onChange={(e) => set('businessHoursOn', e.target.checked)} />
                  <span className="switch-track" />
                </label>
              </div>
            </div>

            {form.businessHoursOn && (
              <div className="hours-grid">
                <div className="field">
                  <label className="label">Starts at</label>
                  <select
                    className="select"
                    value={form.businessHours!.startHour}
                    onChange={(e) =>
                      set('businessHours', { ...form.businessHours!, startHour: Number(e.target.value) })
                    }
                  >
                    {Array.from({ length: 24 }, (_, h) => (
                      <option key={h} value={h}>
                        {String(h).padStart(2, '0')}:00
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label className="label">Ends at</label>
                  <select
                    className="select"
                    value={form.businessHours!.endHour}
                    onChange={(e) => set('businessHours', { ...form.businessHours!, endHour: Number(e.target.value) })}
                  >
                    {Array.from({ length: 24 }, (_, h) => (
                      <option key={h} value={h + 1}>
                        {String(h + 1).padStart(2, '0')}:00
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label className="label">Timezone</label>
                  <input
                    className="input mono"
                    value={form.businessHours!.timezone || ''}
                    onChange={(e) => set('businessHours', { ...form.businessHours!, timezone: e.target.value })}
                    placeholder="Asia/Kolkata"
                  />
                  <div className="field-hint">IANA name — Kerala uses Asia/Kolkata.</div>
                </div>
              </div>
            )}
          </div>

          <div className="card mb-16">
            <h2 className="section-title">Human handover</h2>
            <p className="section-hint">
              When a customer asks for a person, automation pauses for that chat. Staff replies mark the chat as
              handled.
            </p>
            <div className="settings-row">
              <div className="sr-body">
                <div className="sr-title">Resume automation automatically</div>
                <div className="sr-desc">
                  If nobody sends a staff message within this time, the bot takes over the chat again. Keep this on so
                  customers are never left unanswered if staff forgets to return a chat.
                </div>
              </div>
              <div className="sr-control">
                <select
                  className="select inline-select"
                  value={form.handover_timeout_minutes === null ? 'never' : String(form.handover_timeout_minutes)}
                  onChange={(e) =>
                    set('handover_timeout_minutes', e.target.value === 'never' ? null : Number(e.target.value))
                  }
                >
                  {HANDOVER_OPTIONS.map((o) => (
                    <option key={String(o.value)} value={o.value === null ? 'never' : String(o.value)}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          <div className="card">
            <h2 className="section-title">About this deployment</h2>
            <div className="settings-row">
              <div className="sr-body">
                <div className="sr-title">{appName}</div>
                <div className="sr-desc">
                  Single-tenant deployment — your data lives in your own Cloudflare D1 database. Secrets are stored as
                  encrypted Cloudflare Worker secrets; channel tokens are AES-256-GCM encrypted inside the database.
                </div>
              </div>
              <div className="sr-control">
                <span className="badge badge-primary"><IconSettings /> Pilot v0.1</span>
              </div>
            </div>
            <div className="info-banner" style={{ marginBottom: 0 }}>
              <IconZapOff width={18} height={18} />
              <span>
                Emergency stop: switch Automation status to <strong>Off</strong> above and press Save — no automatic
                replies will be sent, while messages keep flowing into the inbox.
              </span>
            </div>
          </div>
        </>
      )}
    </>
  );
}
