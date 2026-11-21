import { useCallback, useEffect, useState } from 'react';
import { Api, ApiError } from '../api';
import type { ChannelAccount, ChannelType, WebhookInfo } from '../api';
import { useAuth } from '../auth';
import { timeAgo, useInterval } from '../hooks';
import {
  IconAlert,
  IconCheck,
  IconEdit,
  IconEye,
  IconEyeOff,
  IconFacebook,
  IconInstagram,
  IconPlug,
  IconPlus,
  IconRefresh,
  IconTrash,
  IconWhatsApp
} from '../icons';
import { useToast } from '../toast';
import { CopyRow, EmptyState, ErrorBanner, LoadingBlock, Modal, PageHeader, StatusChip } from '../ui';

interface PlatformMeta {
  type: ChannelType;
  name: string;
  desc: string;
  accountIdLabel: string;
  accountIdHint: string;
  tokenHint: string;
  webhookPath: 'whatsapp' | 'instagram' | 'facebook';
  webhookField: string;
  requirements: string[];
  webhookSteps: string[];
}

const PLATFORMS: Record<ChannelType, PlatformMeta> = {
  whatsapp: {
    type: 'whatsapp',
    name: 'WhatsApp',
    desc: 'WhatsApp Business Cloud API — the most-used channel.',
    accountIdLabel: 'Phone Number ID',
    accountIdHint: 'Meta App Dashboard → WhatsApp → API Setup → “Phone number ID” (a long number, NOT the phone number itself).',
    tokenHint: 'Meta Business Settings → System users → create an admin system user → Generate token with whatsapp_business_messaging + whatsapp_business_management permissions. System user tokens do not expire.',
    webhookPath: 'whatsapp',
    webhookField: 'messages',
    requirements: [
      'A Meta Business account with WhatsApp Business Account (WABA) created',
      'A WhatsApp phone number (Meta provides a free test number to start)',
      'A System User access token with whatsapp_business_messaging permission',
      'For the free test number: only recipients added to the “To” list in API Setup can receive messages'
    ],
    webhookSteps: [
      'Meta App Dashboard → WhatsApp → Configuration → Edit Webhook',
      'Paste the Callback URL below and enter your META_WEBHOOK_VERIFY_TOKEN value as Verify Token',
      'Click “Verify and Save” — OmniFlow answers Meta’s handshake automatically',
      'Under “Webhook fields” → Manage → subscribe to the “messages” field'
    ]
  },
  instagram: {
    type: 'instagram',
    name: 'Instagram',
    desc: 'Direct messages to your Instagram Professional account.',
    accountIdLabel: 'Instagram Account ID',
    accountIdHint: 'The ID of the Instagram Professional (Business/Creator) account — shown in the Meta App Dashboard → Instagram → API Setup, or via the Graph API “/me/accounts”.',
    tokenHint: 'A Meta access token (from a System User or Business login) that includes instagram_manage_messages and instagram_basic permissions, granted for the app connected to the account.',
    webhookPath: 'instagram',
    webhookField: 'messages',
    requirements: [
      'The Instagram account must be a Professional (Business or Creator) account',
      'It must be linked to a Facebook Page',
      'Access token with instagram_manage_messages + instagram_basic permissions',
      'Customers must message you first — Instagram does not allow opening conversations unprompted'
    ],
    webhookSteps: [
      'Meta App Dashboard → Instagram → your app’s Webhooks section',
      'Paste the Callback URL below and enter your META_WEBHOOK_VERIFY_TOKEN value as Verify Token',
      'Click “Verify and Save”',
      'Subscribe to the “messages” field (and “messaging_postbacks” if you use buttons later)'
    ]
  },
  messenger: {
    type: 'messenger',
    name: 'Messenger',
    desc: 'Facebook Page Messenger conversations.',
    accountIdLabel: 'Facebook Page ID',
    accountIdHint: 'The numeric ID of the Facebook Page (Meta App Dashboard → Messenger → Settings shows the linked Page, or find it under Page “About” → Page ID).',
    tokenHint: 'A Facebook Page access token (not a user token) with pages_messaging permission. Generate it via Business Settings → Accounts → Pages → Generate Token.',
    webhookPath: 'facebook',
    webhookField: 'messages',
    requirements: [
      'A Facebook Page owned by your Business account',
      'Page access token with pages_messaging permission',
      'Your Meta app needs Messenger access — in Development mode only app admins/developers/testers can chat; request Advanced Access for everyone',
      'Customers must message the Page first (24-hour standard messaging window applies)'
    ],
    webhookSteps: [
      'Meta App Dashboard → Messenger → Settings → Webhooks → Add Callback URL',
      'Paste the Callback URL below and enter your META_WEBHOOK_VERIFY_TOKEN value as Verify Token',
      'Click “Verify and Save”',
      'Subscribe to the “messages” field'
    ]
  }
};

function AddWizard({ webhookInfo, onClose, onSaved }: { webhookInfo: WebhookInfo | null; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [step, setStep] = useState(0);
  const [platform, setPlatform] = useState<ChannelType | null>(null);
  const [accountId, setAccountId] = useState('');
  const [name, setName] = useState('');
  const [token, setToken] = useState('');
  const [showToken, setShowToken] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const meta = platform ? PLATFORMS[platform] : null;

  const STEP_TITLES = ['Choose platform', 'Account details', 'Connect webhook', 'Done'];
  const set = (n: number) => setStep(n);

  const submit = async () => {
    if (!platform) return;
    setError(null);
    if (accountId.trim().length < 1) {
      setError(`Enter the ${meta!.accountIdLabel}.`);
      return;
    }
    if (token.trim().length < 10) {
      setError('Enter the access token (at least 10 characters).');
      return;
    }
    setBusy(true);
    try {
      await Api.createAccount({
        channel_type: platform,
        account_id: accountId.trim(),
        access_token: token.trim(),
        name: name.trim() || `${PLATFORMS[platform].name} account`
      });
      toast.success(`${PLATFORMS[platform].name} account connected`);
      set(3);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save the account.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="Connect a channel" onClose={onClose} wide>
      <div className="wizard-steps" style={{ marginBottom: 16 }}>
        {STEP_TITLES.map((t, i) => (
          <div key={t} style={{ display: 'contents' }}>
            <div className={`wizard-step ${step === i ? 'active' : ''} ${step > i ? 'done' : ''}`}>
              <span className="step-dot">{step > i ? <IconCheck width={12} height={12} /> : i + 1}</span>
              <span style={{ display: 'none' }}>{t}</span>
            </div>
            {i < STEP_TITLES.length - 1 && <span className="wizard-step-line" />}
          </div>
        ))}
      </div>

      {step === 0 && (
        <div>
          <p className="section-hint">Which channel do you want to connect? You can add multiple accounts of the same type later.</p>
          <div className="platform-tiles">
            {(Object.values(PLATFORMS) as PlatformMeta[]).map((p) => (
              <button
                key={p.type}
                className={`platform-tile ${p.type}`}
                onClick={() => {
                  setPlatform(p.type);
                  set(1);
                }}
              >
                <span className="pt-icon">
                  {p.type === 'whatsapp' && <IconWhatsApp />}
                  {p.type === 'instagram' && <IconInstagram />}
                  {p.type === 'messenger' && <IconFacebook />}
                </span>
                <span className="pt-name">{p.name}</span>
                <span className="pt-desc">{p.desc}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {step === 1 && meta && (
        <div>
          <ul className="req-list">
            {meta.requirements.map((r) => (
              <li key={r}>
                <IconCheck /> <span>{r}</span>
              </li>
            ))}
          </ul>

          <div className="field" style={{ marginTop: 14 }}>
            <label className="label">{meta.accountIdLabel}</label>
            <input className="input mono" value={accountId} onChange={(e) => setAccountId(e.target.value)} placeholder="Paste the ID" />
            <div className="field-hint">{meta.accountIdHint}</div>
          </div>

          <div className="field">
            <label className="label">
              Account name <span className="optional">optional — shown in the inbox</span>
            </label>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder={`${meta.name} — Main support`} maxLength={100} />
          </div>

          <div className="field">
            <label className="label">Access token</label>
            <div className="input-wrap">
              <input
                className="input mono"
                type={showToken ? 'text' : 'password'}
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="Paste the access token"
                autoComplete="off"
              />
              <button type="button" className="input-affix icon-btn" style={{ width: 36, height: 36 }} onClick={() => setShowToken((v) => !v)} aria-label={showToken ? 'Hide token' : 'Show token'}>
                {showToken ? <IconEyeOff /> : <IconEye />}
              </button>
            </div>
            <div className="field-hint">{meta.tokenHint}</div>
          </div>

          <div className="info-banner">
            <span>
              The token is encrypted with AES-256-GCM before it touches the database, and only a “...last4” preview is
              ever displayed afterwards.
            </span>
          </div>

          {error && <div className="error-banner"><IconAlert /><span>{error}</span></div>}

          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8 }}>
            <button className="btn btn-ghost" onClick={() => set(0)}>Back</button>
            <button className="btn btn-primary" onClick={() => set(2)} disabled={!accountId.trim()}>
              Continue
            </button>
          </div>
        </div>
      )}

      {step === 2 && meta && (
        <div>
          <p className="section-hint">
            Now connect Meta to OmniFlow. Save this account first, then finish the webhook steps in the Meta App
            Dashboard.
          </p>

          <div className="field">
            <label className="label">Callback URL for {meta.name}</label>
            {webhookInfo ? (
              <CopyRow value={webhookInfo.webhooks[meta.type]} />
            ) : (
              <div className="copy-row">
                <code>Could not load — check that the OmniFlow server is running.</code>
              </div>
            )}
          </div>

          <div className="field">
            <label className="label">Verify token</label>
            <div className="field-hint" style={{ marginBottom: 8 }}>
              In Meta’s webhook dialog you must type the exact value you stored as the <code>META_WEBHOOK_VERIFY_TOKEN</code> secret. OmniFlow never displays this value.
            </div>
            {webhookInfo ? (
              webhookInfo.verifyTokenConfigured ? (
                <span className="badge badge-success"><IconCheck /> Verify token is configured on the server</span>
              ) : (
                <span className="badge badge-urgent"><IconAlert /> Not set yet — run “wrangler secret put META_WEBHOOK_VERIFY_TOKEN”</span>
              )
            ) : null}
          </div>

          <div className="field">
            <label className="label">Steps in the Meta App Dashboard</label>
            <ul className="req-list">
              {meta.webhookSteps.map((s) => (
                <li key={s}>
                  <IconCheck /> <span>{s}</span>
                </li>
              ))}
            </ul>
          </div>

          {error && <div className="error-banner"><IconAlert /><span>{error}</span></div>}

          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8 }}>
            <button className="btn btn-ghost" onClick={() => set(1)} disabled={busy}>Back</button>
            <button className="btn btn-primary" onClick={() => void submit()} disabled={busy}>
              {busy ? <span className="spinner spinner-sm" style={{ borderTopColor: '#fff', borderColor: 'rgba(255,255,255,0.4)' }} /> : <IconCheck />} Save account
            </button>
          </div>
        </div>
      )}

      {step === 3 && meta && (
        <div className="success-panel">
          <span className="big-check"><IconCheck /></span>
          <div className="empty-title">{meta.name} account connected</div>
          <p className="section-hint" style={{ textAlign: 'center' }}>
            Finish the webhook subscription steps above in the Meta App Dashboard so incoming messages start flowing
            into the OmniFlow inbox.
            {meta.type === 'whatsapp' && (
              <>
                <br />
                <strong>Tip:</strong> start with Meta’s free test number and add your own WhatsApp number to the “To”
                list before messaging real customers.
              </>
            )}
          </p>
          <button className="btn btn-primary" onClick={onSaved}>
            Done
          </button>
        </div>
      )}
    </Modal>
  );
}

function EditAccountModal({ account, webhookInfo, onClose, onSaved }: { account: ChannelAccount; webhookInfo: WebhookInfo | null; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [name, setName] = useState(account.name);
  const [status, setStatus] = useState<string>(account.status);
  const [token, setToken] = useState('');
  const [showToken, setShowToken] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const meta = PLATFORMS[account.channel_type];

  const submit = async () => {
    setError(null);
    if (!name.trim()) {
      setError('Name cannot be empty.');
      return;
    }
    setBusy(true);
    try {
      const payload: { name?: string; status?: string; access_token?: string } = { name: name.trim(), status };
      if (token.trim().length >= 10) payload.access_token = token.trim();
      await Api.updateAccount(account.id, payload);
      toast.success('Account updated');
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not update the account.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Edit account"
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={() => void submit()} disabled={busy}>
            <IconCheck /> Save changes
          </button>
        </>
      }
    >
      <div className="field">
        <label className="label">Account name</label>
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={100} />
      </div>
      <div className="field">
        <label className="label">Status</label>
        <select className="select" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="active">Connected (active)</option>
          <option value="disconnected">Disconnected</option>
          <option value="expired">Token expired</option>
        </select>
        <div className="field-hint">Disconnected accounts stop replying immediately but keep their history.</div>
      </div>
      <div className="field">
        <label className="label">
          Replace access token <span className="optional">optional</span>
        </label>
        <div className="input-wrap">
          <input
            className="input mono"
            type={showToken ? 'text' : 'password'}
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="Leave empty to keep the current token"
            autoComplete="off"
          />
          <button type="button" className="input-affix icon-btn" style={{ width: 36, height: 36 }} onClick={() => setShowToken((v) => !v)} aria-label={showToken ? 'Hide token' : 'Show token'}>
            {showToken ? <IconEyeOff /> : <IconEye />}
          </button>
        </div>
        <div className="field-hint">
          Current token preview: <code>{account.token_preview}</code>. Rotate the token if it expired (Meta error 190).
        </div>
      </div>
      {webhookInfo && (
        <div className="field">
          <label className="label">{meta.name} webhook callback URL</label>
          <CopyRow value={webhookInfo.webhooks[account.channel_type]} />
        </div>
      )}
      {error && <div className="error-banner"><IconAlert /><span>{error}</span></div>}
    </Modal>
  );
}

export function Channels() {
  const { logout } = useAuth();
  const toast = useToast();
  const [accounts, setAccounts] = useState<ChannelAccount[]>([]);
  const [webhookInfo, setWebhookInfo] = useState<WebhookInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [editing, setEditing] = useState<ChannelAccount | null>(null);
  const [deleting, setDeleting] = useState<ChannelAccount | null>(null);

  const load = useCallback(async () => {
    try {
      const [accs, wi] = await Promise.all([Api.listAccounts(), Api.webhookInfo()]);
      setAccounts(accs.accounts);
      setWebhookInfo(wi);
      setError(null);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        logout();
        return;
      }
      setError(err instanceof ApiError ? err.message : 'Could not load channels.');
    } finally {
      setLoading(false);
    }
  }, [logout]);

  useEffect(() => {
    void load();
  }, [load]);

  useInterval(load, 45000);

  const confirmDelete = async () => {
    if (!deleting) return;
    try {
      await Api.deleteAccount(deleting.id);
      toast.success('Account removed');
      setDeleting(null);
      await load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Could not remove the account.');
    }
  };

  return (
    <>
      <PageHeader
        title="Channels"
        subtitle="Connect WhatsApp, Instagram and Messenger accounts. Add as many accounts as you need."
        actions={
          <>
            <button className="btn btn-soft btn-sm" onClick={() => void load()}>
              <IconRefresh /> Refresh
            </button>
            <button className="btn btn-primary btn-sm" onClick={() => setWizardOpen(true)}>
              <IconPlus /> Add channel
            </button>
          </>
        }
      />

      {error && <ErrorBanner text={error} />}

      {loading ? (
        <LoadingBlock />
      ) : accounts.length === 0 ? (
        <div className="card">
          <EmptyState
            icon={<IconPlug />}
            title="No channels connected"
            sub="Connect your first channel to start receiving customer messages. The wizard explains exactly where to find each ID and token in the Meta App Dashboard."
            action={
              <button className="btn btn-primary" onClick={() => setWizardOpen(true)}>
                <IconPlus /> Connect your first channel
              </button>
            }
          />
        </div>
      ) : (
        <div className="channel-grid">
          {accounts.map((a) => (
            <div key={a.id} className="account-card">
              <div className="account-head">
                <span className={`account-icon ${a.channel_type}`}>
                  {a.channel_type === 'whatsapp' && <IconWhatsApp />}
                  {a.channel_type === 'instagram' && <IconInstagram />}
                  {a.channel_type === 'messenger' && <IconFacebook />}
                </span>
                <div className="flex-1">
                  <div className="account-name">{a.name}</div>
                  <div className="account-id">
                    {PLATFORMS[a.channel_type].accountIdLabel}: {a.account_id}
                  </div>
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <StatusChip status={a.status} />
                <span className="badge badge-neutral">token {a.token_preview}</span>
              </div>
              <div className="account-foot">
                <span className="text-xs muted">Added {timeAgo(a.created_at)}</span>
                <div className="flex gap-8">
                  <button className="icon-btn" aria-label={`Edit ${a.name}`} onClick={() => setEditing(a)}>
                    <IconEdit />
                  </button>
                  <button className="icon-btn danger" aria-label={`Remove ${a.name}`} onClick={() => setDeleting(a)}>
                    <IconTrash />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="card mt-16">
        <h2 className="section-title">Webhook endpoints</h2>
        <p className="section-hint">
          These are the URLs you paste in the Meta App Dashboard. All three channels share the same OmniFlow Worker.
        </p>
        {webhookInfo ? (
          <>
            <CopyRow value={webhookInfo.webhooks.whatsapp} />
            <CopyRow value={webhookInfo.webhooks.instagram} />
            <CopyRow value={webhookInfo.webhooks.messenger} />
            <div style={{ marginTop: 10 }}>
              {webhookInfo.verifyTokenConfigured ? (
                <span className="badge badge-success"><IconCheck /> META_WEBHOOK_VERIFY_TOKEN is configured</span>
              ) : (
                <span className="badge badge-urgent"><IconAlert /> META_WEBHOOK_VERIFY_TOKEN is not set — run “wrangler secret put META_WEBHOOK_VERIFY_TOKEN”</span>
              )}
            </div>
          </>
        ) : (
          <LoadingBlock label="Loading webhook info…" />
        )}
      </div>

      {wizardOpen && (
        <AddWizard
          webhookInfo={webhookInfo}
          onClose={() => setWizardOpen(false)}
          onSaved={() => {
            setWizardOpen(false);
            void load();
          }}
        />
      )}

      {editing && (
        <EditAccountModal
          account={editing}
          webhookInfo={webhookInfo}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void load();
          }}
        />
      )}

      {deleting && (
        <Modal
          title="Remove this account?"
          onClose={() => setDeleting(null)}
          footer={
            <>
              <button className="btn btn-ghost" onClick={() => setDeleting(null)}>
                Cancel
              </button>
              <button className="btn btn-danger" onClick={() => void confirmDelete()}>
                <IconTrash /> Remove
              </button>
            </>
          }
        >
          <p style={{ marginTop: 0 }}>
            <strong>{deleting.name}</strong> will stop receiving messages. Its conversations and messages stay in the
            database, and you can always add the account again.
          </p>
        </Modal>
      )}
    </>
  );
}
