import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Api, ApiError } from '../api';
import type { DailyPoint, ChannelAccount, OverviewStats } from '../api';
import { useAuth } from '../auth';
import { useInterval } from '../hooks';
import {
  IconBolt,
  IconInbox,
  IconMessage,
  IconPlus,
  IconPlug,
  IconRefresh,
  IconTrend,
  IconUserCheck,
  IconZapOff
} from '../icons';
import { ChannelIcon, CHANNEL_LABEL, EmptyState, ErrorBanner, LoadingBlock, PageHeader, StatusChip } from '../ui';

function TrendChart({ series }: { series: DailyPoint[] }) {
  const width = 640;
  const height = 180;
  const pad = { top: 14, right: 8, bottom: 26, left: 8 };
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;
  const max = Math.max(1, ...series.map((d) => Math.max(d.inbound, d.outbound)));
  const groupW = innerW / series.length;
  const barW = Math.min(22, groupW / 3.2);

  const yFor = (v: number) => pad.top + innerH - (v / max) * innerH;

  const dayName = (iso: string) => {
    const d = new Date(iso + 'T00:00:00Z');
    return d.toLocaleDateString('en-IN', { weekday: 'short', timeZone: 'UTC' });
  };

  return (
    <svg className="trend-svg" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" role="img" aria-label="Messages last 7 days">
      {[0.25, 0.5, 0.75, 1].map((f) => (
        <line key={f} x1={pad.left} x2={width - pad.right} y1={yFor(max * f)} y2={yFor(max * f)} stroke="#DDEBE4" strokeWidth={1} />
      ))}
      {series.map((d, i) => {
        const cx = pad.left + groupW * i + groupW / 2;
        const inboundH = (d.inbound / max) * innerH;
        const outboundH = (d.outbound / max) * innerH;
        return (
          <g key={d.day}>
            <rect
              x={cx - barW - 1.5}
              y={yFor(d.inbound)}
              width={barW}
              height={Math.max(inboundH, d.inbound > 0 ? 2 : 0)}
              rx={4}
              fill="#145B50"
            >
              <title>{`Inbound: ${d.inbound}`}</title>
            </rect>
            <rect
              x={cx + 1.5}
              y={yFor(d.outbound)}
              width={barW}
              height={Math.max(outboundH, d.outbound > 0 ? 2 : 0)}
              rx={4}
              fill="#75BFAE"
            >
              <title>{`Outbound: ${d.outbound}`}</title>
            </rect>
            <text x={cx} y={height - 8} textAnchor="middle" fontSize="11" fill="#556E66" fontWeight="600">
              {dayName(d.day)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

export function Dashboard() {
  const { appName } = useAuth();
  const [stats, setStats] = useState<OverviewStats | null>(null);
  const [series, setSeries] = useState<DailyPoint[]>([]);
  const [accounts, setAccounts] = useState<ChannelAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [ov, daily, accs] = await Promise.all([Api.overview(), Api.statsDaily(), Api.listAccounts()]);
      setStats(ov.stats);
      setSeries(daily.series);
      setAccounts(accs.accounts);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load dashboard data.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useInterval(load, 45000);

  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

  return (
    <>
      <PageHeader
        title={`${greeting} 👋`}
        subtitle={`Here is how ${appName} is performing today.`}
        actions={
          <button className="btn btn-soft btn-sm" onClick={() => void load()}>
            <IconRefresh /> Refresh
          </button>
        }
      />

      {error && <ErrorBanner text={error} />}
      {loading && !stats ? (
        <LoadingBlock />
      ) : stats ? (
        <>
          <div className="stat-grid mb-16">
            <div className="stat-card">
              <span className="stat-icon"><IconPlug /></span>
              <span className="stat-value">{stats.active_accounts}</span>
              <span className="stat-label">Connected channels</span>
            </div>
            <div className="stat-card">
              <span className="stat-icon"><IconBolt /></span>
              <span className="stat-value">{stats.active_rules}</span>
              <span className="stat-label">Active auto-replies</span>
            </div>
            <div className="stat-card">
              <span className="stat-icon"><IconInbox /></span>
              <span className="stat-value">{stats.total_conversations}</span>
              <span className="stat-label">Conversations</span>
            </div>
            <div className={`stat-card ${stats.handover_conversations > 0 ? 'urgent' : ''}`}>
              <span className="stat-icon"><IconUserCheck /></span>
              <span className="stat-value">{stats.handover_conversations}</span>
              <span className="stat-label">Needs human attention</span>
            </div>
            <div className="stat-card">
              <span className="stat-icon"><IconMessage /></span>
              <span className="stat-value">{stats.messages_today}</span>
              <span className="stat-label">Messages today</span>
            </div>
            <div className="stat-card">
              <span className="stat-icon"><IconTrend /></span>
              <span className="stat-value">{stats.total_inbound}</span>
              <span className="stat-label">Inbound messages (all time)</span>
            </div>
          </div>

          <div className="card chart-card mb-16">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8, flexWrap: 'wrap', gap: 8 }}>
              <div>
                <h2 className="section-title">Last 7 days</h2>
                <p className="section-hint" style={{ marginBottom: 0 }}>Inbound vs outbound messages per day</p>
              </div>
              <div className="legend">
                <span><span className="legend-dot" style={{ background: '#145B50' }} />Customer messages</span>
                <span><span className="legend-dot" style={{ background: '#75BFAE' }} />Replies sent</span>
              </div>
            </div>
            <TrendChart series={series} />
          </div>

          <div className="card">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 12, flexWrap: 'wrap' }}>
              <div>
                <h2 className="section-title">Connected channels</h2>
                <p className="section-hint" style={{ marginBottom: 0 }}>Accounts that receive and reply to customer messages</p>
              </div>
              <Link to="/channels" className="btn btn-secondary btn-sm">
                <IconPlus /> Add channel
              </Link>
            </div>

            {accounts.length === 0 ? (
              <EmptyState
                icon={<IconZapOff />}
                title="No channels connected yet"
                sub="Connect your WhatsApp, Instagram or Facebook account to start receiving messages in the inbox. The setup wizard walks you through every step."
                action={
                  <Link to="/channels" className="btn btn-primary">
                    <IconPlus /> Connect your first channel
                  </Link>
                }
              />
            ) : (
              <div className="list">
                {accounts.map((a) => (
                  <div key={a.id} className="list-row">
                    <span className={`account-icon ${a.channel_type}`} style={{ width: 38, height: 38, borderRadius: 11 }}>
                      <ChannelIcon channel={a.channel_type} />
                    </span>
                    <div className="list-row-body">
                      <div className="row-title">
                        {a.name}
                        <span className="badge badge-neutral">{CHANNEL_LABEL[a.channel_type]}</span>
                      </div>
                      <div className="row-sub mono">ID {a.account_id} · token {a.token_preview}</div>
                    </div>
                    <div className="row-side">
                      <StatusChip status={a.status} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      ) : null}
    </>
  );
}
