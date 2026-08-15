'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Shield, Check, Sparkles, Lock, Unlock } from 'lucide-react';
import { useWallet } from '../lib/wallet';
import WalletBar from '../components/WalletBar';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';
const PRIVATE_PRICE = process.env.NEXT_PUBLIC_PRIVATE_TIER_PRICE_BOT || '5';
const ULTRA_PRICE = process.env.NEXT_PUBLIC_ULTRA_TIER_PRICE_BOT || '10';
const PREMIUM_PRICE = process.env.NEXT_PUBLIC_CONNECTIONS_PREMIUM_PRICE_BOT || '1';

// Two independent products, each with their own tiers — a wallet's
// "contracts" tier (what MyContracts.jsx manages) and its "connections"
// tier (what ConnectionsPanel.jsx manages) are unrelated to each other,
// so this page shows them as two separate comparisons rather than forcing
// them into one misleading combined ladder.
const CONTRACT_TIERS = [
  {
    id: 'public',
    icon: Unlock,
    name: 'Public',
    price: 'Free',
    period: null,
    tagline: 'Try it on a contract you\u2019re watching casually.',
    features: ['Up to 3 contracts', '20 transactions per contract', 'Live threat feed access', 'Community rule engine'],
  },
  {
    id: 'private',
    icon: Lock,
    name: 'Private',
    price: `${PRIVATE_PRICE} $BOT`,
    period: 'per contract',
    tagline: 'Pay once per contract you actually care about.',
    features: ['Unlimited contracts (pay per one)', '50 transactions per contract', 'Everything in Public', 'One-time payment, no recurring fee'],
  },
  {
    id: 'ultra',
    icon: Sparkles,
    name: 'Ultra Private',
    price: `${ULTRA_PRICE} $BOT`,
    period: 'per year',
    tagline: 'For wallets running a lot of contracts, all-you-can-eat.',
    features: ['Unlimited contracts', 'Unlimited transactions per contract', 'No per-contract fees, ever', 'Manual renewal \u2014 no standing approval'],
    highlight: true,
  },
];

const CONNECTION_TIERS = [
  {
    id: 'free',
    icon: Unlock,
    name: 'Free',
    price: 'Free',
    period: null,
    tagline: 'Watch one wallet or agent.',
    features: ['1 connected wallet/agent', 'Telegram alerts', 'Unlimited alert volume'],
  },
  {
    id: 'premium',
    icon: Lock,
    name: 'Premium',
    price: `${PREMIUM_PRICE} $BOT`,
    period: 'one-time',
    tagline: 'Watch a whole portfolio of wallets and agents.',
    features: ['Up to 20 connected wallets/agents', 'Telegram alerts', 'Up to 1,000 lifetime alerts', 'One-time payment, no recurring fee'],
  },
];

function TierCard({ tier, current, ctaHref, ctaLabel }) {
  const Icon = tier.icon;
  return (
    <div
      className={`relative flex flex-col rounded-xl border p-5 ${
        tier.highlight ? 'border-accent bg-accentSoft' : 'border-line bg-surface'
      }`}
    >
      {tier.highlight && (
        <span className="absolute -top-2.5 left-5 font-mono text-[10px] tracking-wide bg-accent text-paper rounded-full px-2 py-0.5">
          BEST VALUE
        </span>
      )}
      {current && (
        <span className="absolute -top-2.5 right-5 font-mono text-[10px] tracking-wide bg-nominal text-paper rounded-full px-2 py-0.5">
          CURRENT PLAN
        </span>
      )}

      <div className="flex items-center gap-2 mb-1">
        <Icon className={`w-4 h-4 ${tier.highlight ? 'text-accent' : 'text-dim'}`} />
        <h3 className="font-display text-lg text-ink">{tier.name}</h3>
      </div>

      <div className="flex items-baseline gap-1.5 mb-2">
        <span className="font-display text-2xl text-ink">{tier.price}</span>
        {tier.period && <span className="font-mono text-[11px] text-faint">/ {tier.period}</span>}
      </div>

      <p className="font-mono text-[11px] text-faint mb-4 leading-relaxed">{tier.tagline}</p>

      <ul className="space-y-2 mb-6 flex-1">
        {tier.features.map((f) => (
          <li key={f} className="flex items-start gap-2 font-mono text-[11px] text-dim">
            <Check className={`w-3.5 h-3.5 flex-shrink-0 mt-0.5 ${tier.highlight ? 'text-accent' : 'text-nominal'}`} />
            {f}
          </li>
        ))}
      </ul>

      <Link
        href={ctaHref}
        className={`text-center font-mono text-[11px] rounded-full px-3 py-2 transition-colors ${
          current
            ? 'border border-line text-faint cursor-default pointer-events-none'
            : tier.highlight
            ? 'bg-accent text-paper hover:opacity-90'
            : 'border border-accent/40 text-accent hover:bg-accentSoft'
        }`}
      >
        {current ? 'CURRENT PLAN' : ctaLabel}
      </Link>
    </div>
  );
}

export default function Pricing() {
  const wallet = useWallet();
  const { address } = wallet;
  const [contractTier, setContractTier] = useState(null); // 'public' | 'private' | 'ultra' | null
  const [connectionTier, setConnectionTier] = useState(null); // 'free' | 'premium' | null

  useEffect(() => {
    if (!address) {
      setContractTier(null);
      setConnectionTier(null);
      return;
    }
    let cancelled = false;

    fetch(`${API}/api/user/stats?address=${address}`)
      .then((r) => r.json())
      .then((s) => { if (!cancelled) setContractTier(s?.tier || 'public'); })
      .catch(() => {});

    fetch(`${API}/api/connections/${address}`)
      .then((r) => r.json())
      .then((s) => { if (!cancelled) setConnectionTier(s?.tier || 'free'); })
      .catch(() => {});

    return () => { cancelled = true; };
  }, [address]);

  return (
    <div className="min-h-screen bg-paper text-ink">
      <nav className="border-b border-line sticky top-0 bg-paper/90 backdrop-blur z-40">
        <div className="max-w-6xl mx-auto px-5 py-3 flex items-center justify-between">
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

      <section className="max-w-6xl mx-auto px-5 pt-14 pb-8 text-center">
        <h1 className="font-display text-3xl md:text-4xl text-ink mb-3">Pricing</h1>
        <p className="font-mono text-xs text-faint max-w-xl mx-auto">
          Two independent products &mdash; contract monitoring and wallet/agent alerts.
          Mix and match; upgrading one doesn&apos;t require upgrading the other.
        </p>
      </section>

      <section className="max-w-6xl mx-auto px-5 pb-14">
        <div className="mb-3">
          <h2 className="font-display text-lg text-ink">Contract monitoring</h2>
          <p className="font-mono text-[11px] text-faint">Add contracts to the live threat feed under &quot;My contracts.&quot;</p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          {CONTRACT_TIERS.map((tier) => (
            <TierCard
              key={tier.id}
              tier={tier}
              current={contractTier === tier.id}
              ctaHref={address ? '/dashboard#contracts' : '/dashboard'}
              ctaLabel={!address ? 'CONNECT WALLET' : tier.id === 'public' ? 'ADD A CONTRACT' : tier.id === 'private' ? 'ADD PRIVATE CONTRACT' : 'SUBSCRIBE'}
            />
          ))}
        </div>
      </section>

      <section className="max-w-6xl mx-auto px-5 pb-20">
        <div className="mb-3">
          <h2 className="font-display text-lg text-ink">Wallet &amp; agent alerts</h2>
          <p className="font-mono text-[11px] text-faint">Watch specific addresses and get pinged on Telegram under &quot;Connected wallets &amp; agents.&quot;</p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5 max-w-3xl">
          {CONNECTION_TIERS.map((tier) => (
            <TierCard
              key={tier.id}
              tier={tier}
              current={connectionTier === tier.id}
              ctaHref={address ? '/dashboard#connections' : '/dashboard'}
              ctaLabel={!address ? 'CONNECT WALLET' : tier.id === 'free' ? 'CONNECT AN ADDRESS' : 'UPGRADE'}
            />
          ))}
        </div>
      </section>

      <footer className="border-t border-line py-8">
        <div className="max-w-6xl mx-auto px-5 text-xs text-faint font-mono">
          All payments verified on-chain against the treasury address before any tier unlocks. No auto-billing, ever.
        </div>
      </footer>
    </div>
  );
}
