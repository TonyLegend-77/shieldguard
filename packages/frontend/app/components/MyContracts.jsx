'use client';

import { useCallback, useEffect, useState } from 'react';
import { Plus, Lock, Unlock, Loader2, CheckCircle2, XCircle } from 'lucide-react';
import { sendBotPayment } from '../lib/erc20';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';
const PRIVATE_PRICE = process.env.NEXT_PUBLIC_PRIVATE_TIER_PRICE_BOT || '5';
const TREASURY = process.env.NEXT_PUBLIC_TREASURY_ADDRESS;
const BOT_TOKEN = process.env.NEXT_PUBLIC_BOT_TOKEN_ADDRESS;

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
  const [formOpen, setFormOpen] = useState(false);

  const refresh = useCallback(async () => {
    if (!address) return;
    try {
      const [c, s] = await Promise.all([
        fetch(`${API}/api/user/contracts?address=${address}`).then((r) => r.json()),
        fetch(`${API}/api/user/stats?address=${address}`).then((r) => r.json()),
      ]);
      setContracts(Array.isArray(c) ? c : []);
      setStats(s);
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

  return (
    <section className="border border-line bg-panel rounded-sm overflow-hidden animate-fadeUp">
      <div className="border-b border-line px-4 py-3 flex items-center justify-between">
        <h2 className="font-display text-[11px] tracking-[0.15em] text-dim">MY CONTRACTS</h2>
        <button
          onClick={() => setFormOpen((v) => !v)}
          className="inline-flex items-center gap-1 font-mono text-[10px] text-nominal border border-nominal/40 rounded-sm px-2 py-1 hover:bg-nominal/10 transition-colors"
        >
          <Plus className="w-3 h-3" />
          ADD CONTRACT
        </button>
      </div>

      {stats && (
        <div className="px-4 py-3 border-b border-line flex items-center gap-4 font-mono text-[11px] text-dim">
          <span>
            TIER{' '}
            <span className={stats.tier === 'private' ? 'text-nominal' : 'text-ink'}>
              {stats.tier.toUpperCase()}
            </span>
          </span>
          <span>
            CONTRACTS <span className="text-ink">{stats.contractsCount}</span>
          </span>
          <span>
            TX USED <span className="text-ink">{stats.totalTxUsed}</span> / {stats.totalTxLimit || '—'}
          </span>
        </div>
      )}

      {formOpen && (
        <AddContractForm
          wallet={wallet}
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
                {c.tier === 'private' ? <Lock className="w-3 h-3" /> : <Unlock className="w-3 h-3" />}
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

function AddContractForm({ wallet, onAdded }) {
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
      if (tier === 'public') {
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
    <form onSubmit={submit} className="px-4 py-4 border-b border-line bg-raised space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Name"
          className="bg-void border border-line rounded-sm px-2.5 py-1.5 font-mono text-xs text-ink placeholder:text-faint focus:outline-none focus:border-nominal/50"
        />
        <input
          value={contractAddress}
          onChange={(e) => setContractAddress(e.target.value)}
          placeholder="0x contract address"
          className="bg-void border border-line rounded-sm px-2.5 py-1.5 font-mono text-xs text-ink placeholder:text-faint focus:outline-none focus:border-nominal/50"
        />
      </div>

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

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={status === 'paying' || status === 'submitting'}
          className="inline-flex items-center gap-1.5 font-mono text-[11px] text-nominal border border-nominal/40 rounded-sm px-3 py-1.5 hover:bg-nominal/10 transition-colors disabled:opacity-50"
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
