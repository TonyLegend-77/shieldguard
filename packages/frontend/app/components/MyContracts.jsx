'use client';

import { useCallback, useEffect, useState } from 'react';
import { Plus, Lock, Unlock, Loader2, CheckCircle2, XCircle, Sparkles, Bell } from 'lucide-react';
import { sendBotPayment } from '../lib/erc20';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';
const PRIVATE_PRICE = process.env.NEXT_PUBLIC_PRIVATE_TIER_PRICE_BOT || '5';
const ULTRA_PRICE = process.env.NEXT_PUBLIC_ULTRA_TIER_PRICE_BOT || '10';
const TREASURY = process.env.NEXT_PUBLIC_TREASURY_ADDRESS;
const BOT_TOKEN = process.env.NEXT_PUBLIC_BOT_TOKEN_ADDRESS;

const BDEX_URL = 'https://dex.botchain.ai';

// Payments are collected in WBOT (the ERC-20 wrapped version of native
// BOT), not native BOT itself — native tokens can't emit the Transfer
// event our backend verifies against. Shown next to every paid tier so
// someone holding only native BOT doesn't hit a confusing failed tx with
// no explanation.
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
  if (limit <= 0) return 'bg-nominal';
  const pct = count / limit;
  if (pct >= 1) return 'bg-critical';
  if (pct >= 0.75) return 'bg-caution';
  return 'bg-nominal';
}

function UsageBar({ count, limit }) {
  if (limit === 'unlimited' || limit === -1) {
    return <span className="font-mono text-[10px] text-nominal">UNLIMITED</span>;
  }
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

export default function MyContracts({ wallet }) {
  const { address } = wallet;
  const [contracts, setContracts] = useState([]);
  const [stats, setStats] = useState(null);
  const [subscription, setSubscription] = useState(null);
  const [formOpen, setFormOpen] = useState(false);

  const refresh = useCallback(async () => {
    if (!address) return;
    try {
      const [c, s, sub] = await Promise.all([
        fetch(`${API}/api/user/contracts?address=${address}`).then((r) => r.json()),
        fetch(`${API}/api/user/stats?address=${address}`).then((r) => r.json()),
        fetch(`${API}/api/subscription/${address}`).then((r) => r.json()),
      ]);
      setContracts(Array.isArray(c) ? c : []);
      setStats(s);
      setSubscription(sub);
    } catch (err) {
      console.error('[MyContracts] refresh failed:', err.message);
    }
  }, [address]);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 6000);
    return () => clearInterval(id);
  }, [refresh]);

  if (!address) return null;

  const ultraActive = subscription?.active;

  return (
    <section id="contracts" className="border border-line bg-surface rounded-xl overflow-hidden animate-fadeUp">
      <div className="border-b border-line px-4 py-3 flex items-center justify-between">
        <h2 className="font-display text-sm text-ink">My contracts</h2>
        <button
          onClick={() => setFormOpen((v) => !v)}
          className="inline-flex items-center gap-1 font-mono text-[10px] text-accent border border-accent/40 rounded-full px-2 py-1 hover:bg-accentSoft transition-colors"
        >
          <Plus className="w-3 h-3" />
          ADD CONTRACT
        </button>
      </div>

      {stats && (
        <div className="px-4 py-3 border-b border-line flex items-center gap-4 font-mono text-[11px] text-dim flex-wrap">
          <span>
            TIER{' '}
            <span className={stats.tier === 'ultra' ? 'text-accent' : stats.tier === 'private' ? 'text-nominal' : 'text-ink'}>
              {stats.tier.toUpperCase()}
            </span>
          </span>
          <span>
            CONTRACTS <span className="text-ink">{stats.contractsCount}</span>
          </span>
          <span>
            TX USED <span className="text-ink">{stats.totalTxUsed}</span> / {ultraActive ? 'unlimited' : stats.totalTxLimit || '—'}
          </span>
        </div>
      )}

      <UltraSubscriptionBanner wallet={wallet} subscription={subscription} onChanged={refresh} />

      {formOpen && (
        <AddContractForm
          wallet={wallet}
          ultraActive={ultraActive}
          onAdded={() => {
            setFormOpen(false);
            refresh();
          }}
        />
      )}

      <div className="divide-y divide-line">
        {contracts.length === 0 && (
          <p className="font-mono text-xs text-faint px-4 py-6">
            You haven&apos;t added any contracts yet.
          </p>
        )}
        {contracts.map((c) => (
          <div key={c.address} className="px-4 py-3.5">
            <div className="flex items-center justify-between mb-1.5">
              <span className="font-mono text-sm font-medium text-ink">{c.name}</span>
              <span className="flex items-center gap-1 font-mono text-[10px] text-dim">
                {c.tier === 'ultra' ? <Sparkles className="w-3 h-3 text-accent" /> : c.tier === 'private' ? <Lock className="w-3 h-3" /> : <Unlock className="w-3 h-3" />}
                {c.tier.toUpperCase()}
                {!c.isActive && <span className="text-critical ml-1">· PAUSED</span>}
              </span>
            </div>
            <UsageBar count={c.txCount} limit={c.txLimit} />
          </div>
        ))}
      </div>
    </section>
  );
}

// Subscribe / renew / status card for the wallet-wide Ultra Private
// subscription (10 BOT/year — unlimited contracts, unlimited tx per
// contract). Deliberately a manual renewal, not an auto-pull subscription —
// see connections.js for why a tool built around flagging standing
// approvals shouldn't itself rely on one.
function UltraSubscriptionBanner({ wallet, subscription, onChanged }) {
  const { address } = wallet;
  const [status, setStatus] = useState(null); // null | 'paying' | 'submitting' | 'error' | 'done'
  const [error, setError] = useState(null);

  const canSubscribe = Boolean(TREASURY && BOT_TOKEN);
  if (!subscription) return null;

  const subscribe = async () => {
    setError(null);
    if (!canSubscribe) {
      setError('Ultra Private isn\u2019t configured on this deployment yet.');
      setStatus('error');
      return;
    }
    try {
      setStatus('paying');
      const paymentTx = await sendBotPayment({
        fromAddress: address,
        tokenAddress: BOT_TOKEN,
        treasuryAddress: TREASURY,
        amountBOT: ULTRA_PRICE,
      });

      setStatus('submitting');
      const res = await fetch(`${API}/api/subscription/${address}/upgrade`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paymentTxHash: paymentTx }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.reason || data.error || 'Payment sent, but verification failed');
      setStatus('done');
      onChanged();
    } catch (err) {
      setStatus('error');
      setError(err.message);
    }
  };

  // Active, not near expiry — quiet confirmation strip, no upsell needed.
  if (subscription.active && !subscription.renewalDue) {
    return (
      <div className="px-4 py-2.5 border-b border-line bg-accentSoft flex items-center gap-2 font-mono text-[11px] text-accent">
        <Sparkles className="w-3.5 h-3.5 flex-shrink-0" />
        Ultra Private active — unlimited contracts &amp; tx. Renews {new Date(subscription.expiresAt).toLocaleDateString()}.
      </div>
    );
  }

  // Active but within the renewal reminder window (or in grace past expiry).
  if (subscription.active && subscription.renewalDue) {
    return (
      <div className="px-4 py-3 border-b border-line bg-caution/10 space-y-2">
        <div className="flex items-center gap-2 font-mono text-[11px] text-caution">
          <Bell className="w-3.5 h-3.5 flex-shrink-0" />
          {subscription.inGracePeriod
            ? `Ultra Private expired ${Math.abs(subscription.daysRemaining)} day(s) ago — renew before your grace period ends to keep unlimited contracts & tx.`
            : `Ultra Private renews in ${subscription.daysRemaining} day(s).`}
        </div>
        <RenewButton onClick={subscribe} status={status} error={error} label={`RENEW · ${ULTRA_PRICE} $BOT`} />
      </div>
    );
  }

  // No active subscription — the upsell.
  return (
    <div className="px-4 py-3 border-b border-line bg-surfaceAlt space-y-2">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-1.5 font-mono text-[11px] text-ink font-medium">
            <Sparkles className="w-3.5 h-3.5 text-accent" />
            Ultra Private — {ULTRA_PRICE} $BOT/year
          </div>
          <p className="font-mono text-[10px] text-faint mt-1">
            Unlimited contracts, unlimited tx each. No per-contract fees. Manual renewal — no standing approval.
          </p>
        </div>
      </div>
      <WbotNotice />
      <RenewButton onClick={subscribe} status={status} error={error} label={canSubscribe ? `SUBSCRIBE · ${ULTRA_PRICE} $BOT` : 'NOT CONFIGURED'} disabled={!canSubscribe} />
    </div>
  );
}

function RenewButton({ onClick, status, error, label, disabled }) {
  return (
    <div className="flex items-center gap-3">
      <button
        onClick={onClick}
        disabled={disabled || status === 'paying' || status === 'submitting'}
        className="inline-flex items-center gap-1.5 font-mono text-[11px] text-accent border border-accent/40 rounded-full px-3 py-1.5 hover:bg-accentSoft transition-colors disabled:opacity-50"
      >
        {status === 'paying' && (
          <>
            <Loader2 className="w-3 h-3 animate-spin" /> CONFIRM IN WALLET…
          </>
        )}
        {status === 'submitting' && (
          <>
            <Loader2 className="w-3 h-3 animate-spin" /> VERIFYING…
          </>
        )}
        {status !== 'paying' && status !== 'submitting' && label}
      </button>
      {status === 'done' && (
        <span className="inline-flex items-center gap-1 font-mono text-[11px] text-nominal">
          <CheckCircle2 className="w-3.5 h-3.5" /> ACTIVE
        </span>
      )}
      {status === 'error' && (
        <span className="inline-flex items-center gap-1 font-mono text-[11px] text-critical">
          <XCircle className="w-3.5 h-3.5" /> {error}
        </span>
      )}
    </div>
  );
}

function AddContractForm({ wallet, ultraActive, onAdded }) {
  const { address } = wallet;
  const [name, setName] = useState('');
  const [contractAddress, setContractAddress] = useState('');
  const [tier, setTier] = useState('public');
  const [status, setStatus] = useState(null); // null | 'paying' | 'submitting' | 'error' | 'done'
  const [error, setError] = useState(null);

  const canUsePrivate = Boolean(TREASURY && BOT_TOKEN);

  const submit = async (e) => {
    e.preventDefault();
    setError(null);

    if (!/^0x[a-fA-F0-9]{40}$/.test(contractAddress)) {
      setError('Enter a valid contract address (0x… , 40 hex chars).');
      return;
    }
    if (!name.trim()) {
      setError('Give it a name.');
      return;
    }

    try {
      // Ultra Private subscribers always go through the free /monitor path —
      // the backend recognizes their active subscription and auto-upgrades
      // the contract to unlimited regardless of which tier is requested
      // here (see store.js registerGuardian). No point charging them 5 BOT
      // for something already included.
      if (tier === 'public' || ultraActive) {
        setStatus('submitting');
        const res = await fetch(`${API}/monitor`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ address: contractAddress, name, wallet: address }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to add contract');
        setStatus('done');
        onAdded();
      } else {
        setStatus('paying');
        const paymentTx = await sendBotPayment({
          fromAddress: address,
          tokenAddress: BOT_TOKEN,
          treasuryAddress: TREASURY,
          amountBOT: PRIVATE_PRICE,
        });

        setStatus('submitting');
        const res = await fetch(`${API}/monitor/private`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ address: contractAddress, name, wallet: address, paymentTx }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Payment sent, but verification failed');
        setStatus('done');
        onAdded();
      }
    } catch (err) {
      setStatus('error');
      setError(err.message);
    }
  };

  return (
    <form onSubmit={submit} className="px-4 py-4 border-b border-line bg-surfaceAlt space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Name"
          className="bg-surface border border-line rounded-lg px-2.5 py-1.5 font-mono text-xs text-ink placeholder:text-faint focus:outline-none focus:border-accent/50"
        />
        <input
          value={contractAddress}
          onChange={(e) => setContractAddress(e.target.value)}
          placeholder="0x contract address"
          className="bg-surface border border-line rounded-lg px-2.5 py-1.5 font-mono text-xs text-ink placeholder:text-faint focus:outline-none focus:border-accent/50"
        />
      </div>

      {ultraActive ? (
        <p className="flex items-center gap-1.5 font-mono text-[11px] text-accent">
          <Sparkles className="w-3.5 h-3.5" />
          Ultra Private active — this contract will be unlimited automatically, no charge.
        </p>
      ) : (
        <div className="space-y-1.5">
          <div className="flex items-center gap-3 font-mono text-[11px]">
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input type="radio" checked={tier === 'public'} onChange={() => setTier('public')} />
              <span className="text-dim">PUBLIC · FREE</span>
            </label>
            <label className={`flex items-center gap-1.5 ${canUsePrivate ? 'cursor-pointer' : 'opacity-40 cursor-not-allowed'}`}>
              <input
                type="radio"
                checked={tier === 'private'}
                onChange={() => canUsePrivate && setTier('private')}
                disabled={!canUsePrivate}
              />
              <span className="text-dim">PRIVATE · {PRIVATE_PRICE} $BOT</span>
            </label>
          </div>
          {tier === 'private' && <WbotNotice />}
        </div>
      )}

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={status === 'paying' || status === 'submitting'}
          className="inline-flex items-center gap-1.5 font-mono text-[11px] text-accent border border-accent/40 rounded-full px-3 py-1.5 hover:bg-accentSoft transition-colors disabled:opacity-50"
        >
          {status === 'paying' && (
            <>
              <Loader2 className="w-3 h-3 animate-spin" /> CONFIRM {PRIVATE_PRICE} $BOT IN WALLET…
            </>
          )}
          {status === 'submitting' && (
            <>
              <Loader2 className="w-3 h-3 animate-spin" /> REGISTERING…
            </>
          )}
          {status !== 'paying' && status !== 'submitting' && 'SUBMIT'}
        </button>

        {status === 'done' && (
          <span className="inline-flex items-center gap-1 font-mono text-[11px] text-nominal">
            <CheckCircle2 className="w-3.5 h-3.5" /> ADDED
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
