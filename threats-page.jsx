'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Shield } from 'lucide-react';
import ThreatFeed from '../components/ThreatFeed';
import { useWallet } from '../lib/wallet';
import WalletBar from '../components/WalletBar';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

function LiveStat({ label, value }) {
  return (
    <div>
      <p className="font-display text-2xl text-ink">{value ?? '—'}</p>
      <p className="text-[10px] text-faint uppercase tracking-wide">{label}</p>
    </div>
  );
}

// Dedicated, full-page version of the live threat feed — same ThreatFeed.jsx
// the landing page uses as a compact teaser, but here it's the whole point
// of the page: no 8-row cap, taller scrollable box, room to actually sit
// and watch it. See page.jsx for the compact version and ThreatFeed.jsx for
// the shared logic itself.
export default function ThreatsPage() {
  const wallet = useWallet();
  const [stats, setStats] = useState(null);

  useEffect(() => {
    fetch(`${API}/api/stats/global`)
      .then((r) => r.json())
      .then(setStats)
      .catch(() => {});
  }, []);

  return (
    <div className="min-h-screen bg-paper text-ink">
      <nav className="border-b border-line sticky top-0 bg-paper/90 backdrop-blur z-40">
        <div className="max-w-4xl mx-auto px-5 py-3 flex items-center justify-between">
          <Link href="/dashboard" className="flex items-center gap-2">
            <Shield className="w-4.5 h-4.5 text-accent" />
            <span className="font-display text-base text-ink">ShieldGuard</span>
          </Link>
          <div className="hidden md:flex items-center gap-5 font-mono text-[11px] text-dim">
            <Link href="/dashboard" className="hover:text-ink transition-colors">Dashboard</Link>
            <span className="text-ink">Threats</span>
            <Link href="/pricing" className="hover:text-ink transition-colors">Pricing</Link>
          </div>
          <WalletBar wallet={wallet} />
        </div>
      </nav>

      <section className="max-w-4xl mx-auto px-5 pt-10 pb-6 text-center">
        <h1 className="font-display text-2xl md:text-3xl text-ink mb-2">Threat feed</h1>
        <p className="font-mono text-xs text-faint max-w-lg mx-auto">
          Every flagged transaction across every contract ShieldGuard watches, live.
        </p>
      </section>

      {stats && (
        <section className="border-y border-line bg-surfaceAlt py-8 mb-10">
          <div className="max-w-4xl mx-auto px-5 flex flex-wrap items-center justify-center gap-x-10 gap-y-3 text-center">
            <LiveStat label="Contracts watched" value={stats.totalContracts} />
            <LiveStat label="Transactions scanned" value={stats.totalScanned} />
            <LiveStat label="Threats flagged" value={stats.totalFlagged} />
            <LiveStat label="Active right now" value={stats.activeContracts} />
          </div>
        </section>
      )}

      <section className="max-w-4xl mx-auto px-5 pb-16">
        <ThreatFeed />
      </section>
    </div>
  );
}
