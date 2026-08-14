'use client';

import { useCallback, useEffect, useState } from 'react';
import { Plus, Send, Lock, Unlock, Loader2, CheckCircle2, XCircle, Trash2 } from 'lucide-react';
import { sendBotPayment } from '../lib/erc20';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';
const PREMIUM_PRICE_BOT = process.env.NEXT_PUBLIC_CONNECTIONS_PREMIUM_PRICE_BOT || '1';
const TREASURY = process.env.NEXT_PUBLIC_TREASURY_ADDRESS;
const BOT_TOKEN = process.env.NEXT_PUBLIC_BOT_TOKEN_ADDRESS;
const TELEGRAM_BOT_USERNAME = process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME; // e.g. "ShieldGuardAlertsBot", no @
const BDEX_URL = 'https://dex.botchain.ai';

// Same notice as MyContracts.jsx — payments are collected in WBOT (the
// ERC-20 wrapped version), not native BOT, since native transfers don't
// emit the Transfer event our backend verifies against.
function WbotNotice() {
  return (
    <p className="font-mono text-[10px] text-faint">
      Paid in WBOT (wrapped BOT), not native BOT. Only native BOT?{' '}
      <a href={BDEX_URL} target="_blank" rel="noreferrer" className="text-accent hover:underline">
        Wrap it on BDEX first ↗
      </a>
    </p>
  );
}

function usageColor(count, limit) {
  const pct = count / limit;
  if (pct >= 1) return 'bg-critical';
  if (pct >= 0.75) return 'bg-caution';
  return 'bg-nominal';
}

function UsageBar({ count, limit }) {
  const pct = Math.min(100, (count / limit) * 100);
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1 bg-line rounded-full overflow-hidden">
        <div className={`h-full ${usageColor(count, limit)}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="font-mono text-[10px] text-faint whitespace-nowrap">{count}/{limit}</span>
    </div>
  );
}

export default function ConnectionsPanel({ wallet }) {
  const { address } = wallet;
  const [summary, setSummary] = useState(null);
  const [formOpen, setFormOpen] = useState(false);
  const [linkCode, setLinkCode] = useState(null);
  const [linkStatus, setLinkStatus] = useState(null); // null | 'generating' | 'error'

  const refresh = useCallback(async () => {
    if (!address) return;
    try {
      const res = await fetch(`${API}/api/connections/${address}`);
      setSummary(await res.json());
    } catch (err) {
      console.error('[ConnectionsPanel] refresh failed:', err.message);
    }
  }, [address]);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 6000);
    return () => clearInterval(id);
  }, [refresh]);

  const generateLinkCode = async () => {
    setLinkStatus('generating');
    try {
      const res = await fetch(`${API}/api/connections/${address}/telegram/link-code`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to generate link code');
      setLinkCode(data.code);
      setLinkStatus(null);
    } catch (err) {
      setLinkStatus('error');
    }
  };

  const removeWatch = async (watchAddress) => {
    await fetch(`${API}/api/connections/${address}/${watchAddress}`, { method: 'DELETE' });
    refresh();
  };

  if (!address) return null;

  return (
    <section id="connections" className="border border-line bg-surface rounded-xl overflow-hidden animate-fadeUp">
      <div className="border-b border-line px-4 py-3 flex items-center justify-between">
        <h2 className="font-display text-sm text-ink">Connected wallets &amp; agents</h2>
        <button
          onClick={() => setFormOpen((v) => !v)}
          className="inline-flex items-center gap-1 font-mono text-[10px] text-accent border border-accent/40 rounded-full px-2 py-1 hover:bg-accentSoft transition-colors"
        >
          <Plus className="w-3 h-3" />
          CONNECT
        </button>
      </div>

      {summary && (
        <div className="px-4 py-3 border-b border-line flex items-center gap-4 font-mono text-[11px] text-dim flex-wrap">
          <span>
            TIER{' '}
            <span className={summary.tier === 'premium' ? 'text-nominal' : 'text-ink'}>
              {summary.tier.toUpperCase()}
            </span>
          </span>
          <span className="flex-1 max-w-[160px]">
            <UsageBar count={summary.used} limit={summary.limit} />
          </span>
          {summary.txLimit != null && (
            <span className="flex items-center gap-1 whitespace-nowrap">
              ALERTS <span className="text-ink">{summary.txUsed}</span>/{summary.txLimit}
            </span>
          )}
          <span className="flex items-center gap-1">
            <Send className="w-3 h-3" />
            {summary.telegramLinked ? (
              <span className="text-nominal">TELEGRAM LINKED</span>
            ) : (
              <span className="text-faint">NO TELEGRAM</span>
            )}
          </span>
        </div>
      )}

      {!summary?.telegramLinked && (
        <div className="px-4 py-3 border-b border-line bg-surfaceAlt">
          {!linkCode ? (
            <button
              onClick={generateLinkCode}
              disabled={linkStatus === 'generating'}
              className="inline-flex items-center gap-1.5 font-mono text-[11px] text-accent border border-accent/40 rounded-full px-3 py-1.5 hover:bg-accentSoft transition-colors disabled:opacity-50"
            >
              {linkStatus === 'generating' ? (
                <>
                  <Loader2 className="w-3 h-3 animate-spin" /> GENERATING…
                </>
              ) : (
                'LINK TELEGRAM FOR ALERTS'
              )}
            </button>
          ) : (
            <div className="font-mono text-[11px] text-dim space-y-1">
              <p>
                Message{' '}
                {TELEGRAM_BOT_USERNAME ? (
                  <a
                    href={`https://t.me/${TELEGRAM_BOT_USERNAME}`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-accent underline"
                  >
                    @{TELEGRAM_BOT_USERNAME}
                  </a>
                ) : (
                  'the ShieldGuard bot'
                )}{' '}
                with:
              </p>
              <code className="block bg-surface border border-line rounded-lg px-2.5 py-1.5 text-ink">
                /start {linkCode}
              </code>
            </div>
          )}
          {linkStatus === 'error' && (
            <span className="inline-flex items-center gap-1 font-mono text-[11px] text-critical mt-1">
              <XCircle className="w-3.5 h-3.5" /> Failed to generate link code
            </span>
          )}
        </div>
      )}

      {formOpen && (
        <ConnectForm
          wallet={wallet}
          summary={summary}
          onAdded={() => {
            setFormOpen(false);
            refresh();
          }}
        />
      )}

      <div className="divide-y divide-line">
        {(!summary || summary.connections.length === 0) && (
          <p className="font-mono text-xs text-faint px-4 py-6">
            No wallets or agents connected yet.
          </p>
        )}
        {summary?.connections.map((c) => (
          <div key={c.watchAddress} className="px-4 py-3.5 flex items-center justify-between">
            <div>
              <span className="font-mono text-sm text-ink">{c.watchAddress}</span>
              <span className="ml-2 font-mono text-[10px] text-dim uppercase">{c.type}</span>
            </div>
            <button
              onClick={() => removeWatch(c.watchAddress)}
              className="text-faint hover:text-critical transition-colors"
              title="Disconnect"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}

function ConnectForm({ wallet, summary, onAdded }) {
  const { address } = wallet;
  const [watchAddress, setWatchAddress] = useState('');
  const [type, setType] = useState('wallet');
  const [status, setStatus] = useState(null); // null | 'submitting' | 'paying' | 'error' | 'done'
  const [error, setError] = useState(null);

  const atLimit = summary && summary.used >= summary.limit;
  const isFree = summary?.tier === 'free';
  const canUpgrade = Boolean(TREASURY && BOT_TOKEN);

  const submitConnection = async () => {
    setStatus('submitting');
    const res = await fetch(`${API}/api/connections/${address}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ watchAddress, type }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.reason || 'Failed to connect');
    setStatus('done');
    onAdded();
  };

  const submit = async (e) => {
    e.preventDefault();
    setError(null);

    if (!/^0x[a-fA-F0-9]{40}$/.test(watchAddress)) {
      setError('Enter a valid address (0x…, 40 hex chars).');
      return;
    }

    try {
      await submitConnection();
    } catch (err) {
      setStatus('error');
      setError(err.message);
    }
  };

  const upgradeThenConnect = async () => {
    setError(null);
    if (!/^0x[a-fA-F0-9]{40}$/.test(watchAddress)) {
      setError('Enter a valid address (0x…, 40 hex chars) before upgrading.');
      return;
    }
    try {
      setStatus('paying');
      const paymentTx = await sendBotPayment({
        fromAddress: address,
        tokenAddress: BOT_TOKEN,
        treasuryAddress: TREASURY,
        amountBOT: PREMIUM_PRICE_BOT,
      });

      setStatus('submitting');
      const upgradeRes = await fetch(`${API}/api/connections/${address}/upgrade`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paymentTxHash: paymentTx }),
      });
      const upgradeData = await upgradeRes.json();
      if (!upgradeRes.ok) throw new Error(upgradeData.reason || 'Payment sent, but upgrade verification failed');

      await submitConnection();
    } catch (err) {
      setStatus('error');
      setError(err.message);
    }
  };

  return (
    <form onSubmit={submit} className="px-4 py-4 border-b border-line bg-surfaceAlt space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <input
          value={watchAddress}
          onChange={(e) => setWatchAddress(e.target.value)}
          placeholder="0x wallet or agent address"
          className="bg-surface border border-line rounded-lg px-2.5 py-1.5 font-mono text-xs text-ink placeholder:text-faint focus:outline-none focus:border-accent/50"
        />
        <div className="flex items-center gap-3 font-mono text-[11px]">
          <label className="flex items-center gap-1.5 cursor-pointer">
            <input type="radio" checked={type === 'wallet'} onChange={() => setType('wallet')} />
            <span className="text-dim">WALLET</span>
          </label>
          <label className="flex items-center gap-1.5 cursor-pointer">
            <input type="radio" checked={type === 'agent'} onChange={() => setType('agent')} />
            <span className="text-dim">AGENT</span>
          </label>
        </div>
      </div>

      {atLimit && isFree && (
        <p className="font-mono text-[11px] text-caution flex items-center gap-1">
          <Lock className="w-3 h-3" />
          Free tier limit reached — upgrade to premium ({PREMIUM_PRICE_BOT} $BOT) for up to 20 connections and 1,000 alerts.
        </p>
      )}
      {atLimit && !isFree && (
        <p className="font-mono text-[11px] text-critical">Premium limit (20 connections) reached.</p>
      )}
      {atLimit && isFree && canUpgrade && <WbotNotice />}

      <div className="flex items-center gap-3">
        {!atLimit && (
          <button
            type="submit"
            disabled={status === 'submitting' || status === 'paying'}
            className="inline-flex items-center gap-1.5 font-mono text-[11px] text-accent border border-accent/40 rounded-full px-3 py-1.5 hover:bg-accentSoft transition-colors disabled:opacity-50"
          >
            {status === 'submitting' ? (
              <>
                <Loader2 className="w-3 h-3 animate-spin" /> CONNECTING…
              </>
            ) : (
              'CONNECT'
            )}
          </button>
        )}

        {atLimit && isFree && canUpgrade && (
          <button
            type="button"
            onClick={upgradeThenConnect}
            disabled={status === 'paying' || status === 'submitting'}
            className="inline-flex items-center gap-1.5 font-mono text-[11px] text-accent border border-accent/40 rounded-full px-3 py-1.5 hover:bg-accentSoft transition-colors disabled:opacity-50"
          >
            {status === 'paying' && (
              <>
                <Loader2 className="w-3 h-3 animate-spin" /> CONFIRM {PREMIUM_PRICE_BOT} $BOT IN WALLET…
              </>
            )}
            {status === 'submitting' && (
              <>
                <Loader2 className="w-3 h-3 animate-spin" /> UPGRADING…
              </>
            )}
            {status !== 'paying' && status !== 'submitting' && (
              <>
                <Unlock className="w-3 h-3" /> UPGRADE &amp; CONNECT
              </>
            )}
          </button>
        )}

        {status === 'done' && (
          <span className="inline-flex items-center gap-1 font-mono text-[11px] text-nominal">
            <CheckCircle2 className="w-3.5 h-3.5" /> CONNECTED
          </span>
        )}
        {status === 'error' && (
          <span className="inline-flex items-center gap-1 font-mono text-[11px] text-critical">
            <XCircle className="w-3.5 h-3.5" /> {error}
          </span>
        )}
      </div>
    </form>
  );
}
