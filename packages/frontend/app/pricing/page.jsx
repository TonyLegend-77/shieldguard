'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Shield, Check, Loader2, CheckCircle2, XCircle, Unlock } from 'lucide-react';
import { useWallet } from '../lib/wallet';
import { sendBotPayment } from '../lib/erc20';
import WalletBar from '../components/WalletBar';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

// Same env-driven prices MyContracts.jsx uses for the actual charge —
// keep these two files in sync if the tier prices ever change server-side.
const PRIVATE_PRICE = process.env.NEXT_PUBLIC_PRIVATE_TIER_PRICE_BOT || '5';
const ULTRA_PRICE = process.env.NEXT_PUBLIC_ULTRA_TIER_PRICE_BOT || '10';
const PREMIUM_CONNECTIONS_PRICE = process.env.NEXT_PUBLIC_CONNECTIONS_PREMIUM_PRICE_BOT || '1';
const TREASURY = process.env.NEXT_PUBLIC_TREASURY_ADDRESS;
const BOT_TOKEN = process.env.NEXT_PUBLIC_BOT_TOKEN_ADDRESS;
const BDEX_URL = 'https://dex.botchain.ai';

const CONTRACT_TIERS = [
  {
    name: 'Public',
    price: 'Free',
    unit: '',
    description: 'Get monitoring running and see how ShieldGuard flags a contract.',
    features: [
      'Up to 3 publicly monitored contracts',
      '20 scanned transactions / day per contract',
      '1 personal Telegram connection',
      'Full rule engine + AI advisory verdicts',
    ],
    cta: 'Open the dashboard',
    href: '/dashboard',
    highlight: false,
  },
  {
    name: 'Private',
    price: PRIVATE_PRICE,
    unit: '$BOT per contract',
    description: 'For contracts you don\u2019t want listed on the public threat feed.',
    features: [
      'Unlimited private contracts (past the free 3)',
      '50 scanned transactions / day per contract',
      'Not shown on the public /threats feed',
      'One-time payment per contract, no renewal',
    ],
    cta: 'Add a private contract',
    href: '/dashboard',
    highlight: false,
  },
  {
    name: 'Ultra Private',
    price: ULTRA_PRICE,
    unit: '$BOT / year',
    description: 'Everything under one wallet, no per-contract math.',
    features: [
      'Unlimited contracts, unlimited tx each',
      'No per-contract fees \u2014 new contracts auto-upgrade',
      'Manual renewal only \u2014 no standing approval pulled from your wallet',
      'Same rule engine + simulation + AI advisory as every other tier',
    ],
    cta: 'Subscribe',
    href: '/dashboard',
    highlight: true,
  },
];

// Standalone upgrade flow for the pricing page — same payment + verify
// sequence ConnectionsPanel.jsx's "UPGRADE & CONNECT" button runs, but not
// tied to also connecting a watch address, and visible regardless of
// whether the wallet has hit its free-tier limit yet. This is the piece
// that was missing: previously the only way to upgrade was to first hit
// the free-tier connection cap inside the dashboard panel.
function PremiumConnectionsUpgrade({ wallet }) {
  const { address } = wallet;
  const [summary, setSummary] = useState(null);
  const [status, setStatus] = useState(null); // null | 'paying' | 'submitting' | 'error' | 'done'
  const [error, setError] = useState(null);

  const refresh = useCallback(async () => {
    if (!address) return;
    try {
      const res = await fetch(`${API}/api/connections/${address}`);
      setSummary(await res.json());
    } catch (err) {
      console.error('[PremiumConnectionsUpgrade] refresh failed:', err.message);
    }
  }, [address]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const canUpgrade = Boolean(TREASURY && BOT_TOKEN);
  const isPremium = summary?.tier === 'premium';

  const upgrade = async () => {
    setError(null);
    try {
      setStatus('paying');
      const paymentTx = await sendBotPayment({
        fromAddress: address,
        tokenAddress: BOT_TOKEN,
        treasuryAddress: TREASURY,
        amountBOT: PREMIUM_CONNECTIONS_PRICE,
      });

      setStatus('submitting');
      const res = await fetch(`${API}/api/connections/${address}/upgrade`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paymentTxHash: paymentTx }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.reason || 'Payment sent, but upgrade verification failed');

      setStatus('done');
      refresh();
    } catch (err) {
      setStatus('error');
      setError(err.message);
    }
  };

  if (!address) {
    return <p className="text-xs text-body">Connect a wallet above to upgrade.</p>;
  }

  if (isPremium) {
    return (
      <span className="inline-flex items-center gap-1.5 font-mono text-[11px] text-nominal">
        <CheckCircle2 className="w-3.5 h-3.5" /> Already premium
      </span>
    );
  }

  if (!canUpgrade) {
    return <p className="text-xs text-faint font-mono">Upgrades aren't configured on this server yet.</p>;
  }

  return (
    <div className="space-y-2">
      <button
        onClick={upgrade}
        disabled={status === 'paying' || status === 'submitting'}
        className="inline-flex items-center gap-1.5 font-mono text-[11px] bg-accent text-white rounded-full px-4 py-2 hover:bg-accent/90 transition-colors disabled:opacity-50"
      >
        {status === 'paying' && (
          <>
            <Loader2 className="w-3 h-3 animate-spin" /> CONFIRM {PREMIUM_CONNECTIONS_PRICE} $BOT IN WALLET…
          </>
        )}
        {status === 'submitting' && (
          <>
            <Loader2 className="w-3 h-3 animate-spin" /> UPGRADING…
          </>
        )}
        {status !== 'paying' && status !== 'submitting' && (
          <>
            <Unlock className="w-3 h-3" /> UPGRADE FOR {PREMIUM_CONNECTIONS_PRICE} $BOT
          </>
        )}
      </button>
      <p className="font-mono text-[10px] text-faint">
        Paid in WBOT (wrapped BOT), not native BOT. Only native BOT?{' '}
        <a href={BDEX_URL} target="_blank" rel="noreferrer" className="text-accent hover:underline">
          Wrap it on BDEX first ↗
        </a>
      </p>
      {status === 'error' && (
        <span className="inline-flex items-center gap-1 font-mono text-[11px] text-critical">
          <XCircle className="w-3.5 h-3.5" /> {error}
        </span>
      )}
    </div>
  );
}

export default function PricingPage() {
  const wallet = useWallet();

  return (
    <div className="min-h-screen bg-paper text-ink">
      <nav className="border-b border-line sticky top-0 bg-paper/90 backdrop-blur z-40">
        <div className="max-w-5xl mx-auto px-5 py-3 flex items-center justify-between">
          <Link href="/dashboard" className="flex items-center gap-2">
            <Shield className="w-4.5 h-4.5 text-accent" />
            <span className="font-display text-base text-ink">ShieldGuard</span>
          </Link>
          <div className="hidden md:flex items-center gap-5 font-mono text-[11px] text-dim">
            <Link href="/dashboard" className="hover:text-ink transition-colors">Dashboard</Link>
            <Link href="/threats" className="hover:text-ink transition-colors">Threats</Link>
            <span className="text-ink">Pricing</span>
          </div>
          <WalletBar wallet={wallet} />
        </div>
      </nav>

      <section className="max-w-3xl mx-auto px-5 pt-14 pb-8 text-center">
        <h1 className="font-display text-2xl md:text-3xl text-ink mb-3">Pricing</h1>
        <p className="font-mono text-xs text-faint max-w-xl mx-auto leading-relaxed">
          Monitoring and the rule engine are free to try. Paid tiers lift the free public limit or
          keep a contract off the public feed \u2014 nothing here changes how validation works, only
          how many contracts you can watch and who can see them.
        </p>
      </section>

      <section className="max-w-5xl mx-auto px-5 pb-6">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          {CONTRACT_TIERS.map((tier) => (
            <div
              key={tier.name}
              className={`rounded-xl border p-6 flex flex-col ${
                tier.highlight ? 'border-accent bg-accentSoft/40 md:-translate-y-2 shadow-sm' : 'border-line bg-surface'
              }`}
            >
              {tier.highlight && (
                <span className="self-start bg-accent text-white text-[10px] font-mono uppercase tracking-wide rounded-full px-2.5 py-1 mb-3">
                  Best value
                </span>
              )}
              <h2 className="font-display text-lg text-ink mb-1">{tier.name}</h2>
              <div className="flex items-baseline gap-1.5 mb-3">
                <span className="font-display text-3xl text-ink">{tier.price}</span>
                {tier.unit && <span className="font-mono text-[11px] text-faint">{tier.unit}</span>}
              </div>
              <p className="text-xs text-body leading-relaxed mb-5">{tier.description}</p>
              <ul className="space-y-2.5 mb-6 flex-1">
                {tier.features.map((f) => (
                  <li key={f} className="flex items-start gap-2 text-xs text-body">
                    <Check className="w-3.5 h-3.5 text-accent shrink-0 mt-0.5" />
                    <span>{f}</span>
                  </li>
                ))}
              </ul>
              <Link
                href={tier.href}
                className={`text-center font-mono text-[11px] rounded-full px-4 py-2 transition-colors ${
                  tier.highlight
                    ? 'bg-accent text-white hover:bg-accent/90'
                    : 'border border-line text-dim hover:text-ink hover:border-accent/40'
                }`}
              >
                {tier.cta}
              </Link>
            </div>
          ))}
        </div>
      </section>

      <section className="max-w-5xl mx-auto px-5 py-10 border-t border-line">
        <h2 className="font-display text-lg text-ink mb-1">Personal alert connections</h2>
        <p className="text-xs text-body leading-relaxed mb-5 max-w-2xl">
          Separate from contract tiers above \u2014 this controls how many wallets or agent addresses
          you can link to your own Telegram alerts.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <div className="rounded-xl border border-line bg-surface p-5">
            <div className="flex items-baseline gap-1.5 mb-2">
              <span className="font-display text-xl text-ink">Free</span>
            </div>
            <p className="text-xs text-body">1 connection.</p>
          </div>
          <div className="rounded-xl border border-line bg-surface p-5">
            <div className="flex items-baseline gap-1.5 mb-2">
              <span className="font-display text-xl text-ink">{PREMIUM_CONNECTIONS_PRICE}</span>
              <span className="font-mono text-[11px] text-faint">$BOT, one-time</span>
            </div>
            <p className="text-xs text-body mb-4">Up to 20 connections and 1,000 alerts.</p>
            <PremiumConnectionsUpgrade wallet={wallet} />
          </div>
        </div>
      </section>

      <section className="max-w-5xl mx-auto px-5 pb-16">
        <p className="font-mono text-[10px] text-faint text-center">
          Every paid tier above is billed in WBOT (wrapped BOT), not native BOT \u2014 native tokens
          can\u2019t emit the Transfer event payments are verified against. Only holding native BOT?{' '}
          <a href={BDEX_URL} target="_blank" rel="noreferrer" className="text-accent hover:underline">
            Wrap it on BDEX first \u2197
          </a>
        </p>
      </section>
    </div>
  );
}
