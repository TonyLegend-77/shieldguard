'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Shield, Eye, FileSignature, KeyRound, ArrowRight, Radio } from 'lucide-react';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

const SIMULATED_FEED = [
  { token: 'NyxBatchAuction', reason: 'Unlimited approve() to an unverified contract deployed 40 minutes ago', risk: 'CRITICAL' },
  { token: 'TokenFactory', reason: 'transferOwnership() called from a non-multisig address', risk: 'CRITICAL' },
  { token: 'MultiSigWallet', reason: 'setApprovalForAll(true) granted to a flagged operator address', risk: 'HIGH' },
  { token: 'GaslessGuest', reason: 'Proxy implementation slot mutated mid-transaction — simulation caught it before signing', risk: 'CRITICAL' },
  { token: 'Wattline', reason: 'Approval amount 15x above this wallet\u2019s historical average', risk: 'HIGH' },
  { token: 'MockSwap', reason: 'Multi-call routes through 3 contracts before an unlimited approval — flagged by state-diff simulation', risk: 'HIGH' },
];

export default function LandingPage() {
  const [stats, setStats] = useState(null);
  const [feed, setFeed] = useState([]);
  const [mode, setMode] = useState('live'); // 'live' | 'simulated'
  const [simFeed, setSimFeed] = useState([]);

  useEffect(() => {
    fetch(`${API}/api/stats/global`)
      .then((r) => r.json())
      .then(setStats)
      .catch(() => {});
  }, []);

  useEffect(() => {
    const loadFeed = () => {
      fetch(`${API}/api/alerts/global`)
        .then((r) => r.json())
        .then((data) => setFeed(Array.isArray(data) ? data.slice(0, 8) : []))
        .catch(() => {});
    };
    loadFeed();
    const id = setInterval(loadFeed, 5000);
    return () => clearInterval(id);
  }, []);

  // Simulated playback: cycles through SIMULATED_FEED one entry at a time,
  // clearly labeled as simulated (never presented as real data) — for
  // showing the product in action when there's no live flagged traffic to
  // point at.
  useEffect(() => {
    if (mode !== 'simulated') return;
    setSimFeed([]);
    let i = 0;
    const id = setInterval(() => {
      setSimFeed((prev) => [SIMULATED_FEED[i % SIMULATED_FEED.length], ...prev].slice(0, 8));
      i += 1;
    }, 2200);
    return () => clearInterval(id);
  }, [mode]);

  return (
    <main className="min-h-screen bg-paper">
      <div className="max-w-5xl mx-auto px-5">

        <nav className="flex items-center justify-between py-6">
          <div className="flex items-center gap-2">
            <Shield className="w-5 h-5 text-accent" strokeWidth={1.75} />
            <span className="font-display text-lg font-medium text-ink">ShieldGuard</span>
          </div>
          <Link
            href="/dashboard"
            className="inline-flex items-center gap-1.5 bg-accent text-white text-sm font-medium rounded-full px-4 py-2 hover:bg-accent/90 transition-colors"
          >
            Open the dashboard
          </Link>
        </nav>

        {/* Hero */}
        <section className="pt-10 pb-16 text-center animate-fadeUp">
          <span className="inline-flex items-center gap-1.5 bg-accentSoft text-accent text-xs font-medium rounded-full px-3 py-1 mb-6">
            <span className="w-1.5 h-1.5 rounded-full bg-nominal" />
            Live on BOT Chain testnet 968
          </span>

          <h1 className="font-display text-4xl md:text-6xl leading-[1.1] text-ink mb-5">
            Catch the drain<br />before it happens.
          </h1>

          <p className="max-w-xl mx-auto text-body text-base md:text-lg leading-relaxed mb-8">
            ShieldGuard watches every approval, transfer, and agent transaction live —
            flags the threat, signs the verdict, and anchors the proof on-chain.
            Detection and proof, never custody.
          </p>

          <div className="flex items-center justify-center gap-5">
            <Link
              href="/dashboard"
              className="inline-flex items-center gap-1.5 bg-accent text-white text-sm font-medium rounded-full px-5 py-2.5 hover:bg-accent/90 transition-colors"
            >
              Open the dashboard
              <ArrowRight className="w-3.5 h-3.5" />
            </Link>
            <a
              href="https://github.com/TonyLegend-77/shieldguard"
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm font-medium text-ink hover:text-accent transition-colors"
            >
              View the source →
            </a>
          </div>
        </section>
      </div>

      {/* The problem */}
      <section className="bg-surfaceAlt py-16">
        <div className="max-w-5xl mx-auto px-5 grid grid-cols-1 md:grid-cols-[1fr_1.2fr] gap-8">
          <div>
            <p className="text-xs font-medium tracking-wide text-dim uppercase mb-2">The problem</p>
            <h2 className="font-display text-2xl md:text-3xl text-ink leading-snug">
              One signature is all it takes.
            </h2>
          </div>
          <p className="text-body leading-relaxed">
            An unlimited <code className="font-mono text-sm bg-white border border-line rounded px-1.5 py-0.5">approve()</code>{' '}
            or a blanket <code className="font-mono text-sm bg-white border border-line rounded px-1.5 py-0.5">setApprovalForAll()</code>{' '}
            hands a stranger standing permission to drain a wallet — any time, without
            warning. AI agents make it worse: one prompt injection or hallucinated
            action, and a key with no supervision can move everything. Most tools
            only tell you after it's already gone.
          </p>
        </div>
      </section>

      {/* How it watches */}
      <section className="py-16">
        <div className="max-w-5xl mx-auto px-5">
          <p className="text-xs font-medium tracking-wide text-dim uppercase mb-2 text-center">How it watches</p>
          <h2 className="font-display text-2xl md:text-3xl text-ink text-center mb-10">
            Three ways to catch a threat, one way to prove it.
          </h2>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            <FeatureCard
              icon={<Eye className="w-5 h-5" />}
              title="On-chain, live"
              body="Polls Approval, Transfer, ApprovalForAll, OwnershipTransferred, and Paused events every few seconds — plus raw transaction calldata for contracts with no standard event to watch."
            />
            <FeatureCard
              icon={<KeyRound className="w-5 h-5" />}
              title="Pre-signing, for agents"
              body="A non-custodial SDK checks a transaction against the same rule engine before an AI agent ever signs it. ShieldGuard never holds the key — only returns a verdict."
            />
            <FeatureCard
              icon={<FileSignature className="w-5 h-5" />}
              title="Signed and anchored"
              body="Every flagged result gets an AI verdict, a cryptographic signature, and a permanent on-chain receipt — so a threat can't be quietly edited or disputed later."
            />
          </div>
        </div>
      </section>

      {/* Live proof */}
      <section className="bg-surfaceAlt py-12">
        <div className="max-w-5xl mx-auto px-5 flex flex-wrap items-center justify-center gap-x-12 gap-y-4 text-center">
          <LiveStat label="Contracts watched" value={stats?.totalContracts} />
          <LiveStat label="Transactions scanned" value={stats?.totalScanned} />
          <LiveStat label="Threats flagged" value={stats?.totalFlagged} />
          <LiveStat label="Active right now" value={stats?.activeContracts} />
        </div>
      </section>

      {/* Live feed — real data by default. Simulated mode is clearly labeled
          and never mixed with real entries, so it can't be mistaken for
          actual activity. */}
      <section className="py-16">
        <div className="max-w-3xl mx-auto px-5">
          <div className="flex items-center justify-center gap-3 mb-6 flex-wrap">
            <Radio className={`w-4 h-4 ${mode === 'live' ? 'text-nominal animate-pulse' : 'text-accent'}`} />
            <h2 className="font-display text-lg text-ink">
              {mode === 'live' ? 'Live threat feed' : 'Simulated threat feed'}
            </h2>
            <div className="inline-flex items-center bg-surfaceAlt border border-line rounded-full p-0.5 font-mono text-[10px]">
              <button
                onClick={() => setMode('live')}
                className={`px-2.5 py-1 rounded-full transition-colors ${
                  mode === 'live' ? 'bg-white text-ink shadow-sm' : 'text-faint hover:text-dim'
                }`}
              >
                LIVE
              </button>
              <button
                onClick={() => setMode('simulated')}
                className={`px-2.5 py-1 rounded-full transition-colors ${
                  mode === 'simulated' ? 'bg-white text-ink shadow-sm' : 'text-faint hover:text-dim'
                }`}
              >
                SIMULATED DEMO
              </button>
            </div>
          </div>

          {mode === 'simulated' && (
            <p className="text-center font-mono text-[10px] text-caution mb-3">
              ⚠ Simulated for demonstration — not real transactions
            </p>
          )}
          {mode === 'live' && (
            <p className="text-center font-mono text-[10px] text-faint mb-3">
              polling every 5s · real production data
            </p>
          )}

          <div className="border border-line bg-white rounded-xl overflow-hidden">
            {mode === 'live' && feed.length === 0 && (
              <p className="font-mono text-xs text-faint px-4 py-8 text-center">
                No flagged activity in the current window — that&apos;s good news. This
                feed updates the moment something gets caught. Switch to the
                simulated demo above to see it in action.
              </p>
            )}
            {mode === 'simulated' && simFeed.length === 0 && (
              <p className="font-mono text-xs text-faint px-4 py-8 text-center">
                Starting simulation…
              </p>
            )}
            <div className="divide-y divide-line">
              {(mode === 'live' ? feed : simFeed).map((a, i) => (
                <div
                  key={`${mode}-${a.hash || a.txHash || i}-${i}`}
                  className="px-4 py-3 flex items-center justify-between gap-3 animate-fadeUp"
                  style={{ animationDelay: mode === 'live' ? `${i * 40}ms` : '0ms' }}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span
                      className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                        a.risk === 'CRITICAL' || a.severity === 'CRITICAL'
                          ? 'bg-critical'
                          : a.risk === 'HIGH' || a.severity === 'HIGH'
                          ? 'bg-caution'
                          : 'bg-nominal'
                      }`}
                    />
                    <span className="font-mono text-xs text-ink truncate">
                      {a.token || a.tokenAddress || 'Unknown contract'}
                    </span>
                    <span className="font-mono text-[11px] text-dim truncate hidden sm:inline">
                      {a.reason}
                    </span>
                  </div>
                  <span className="font-mono text-[10px] text-faint flex-shrink-0">
                    {a.risk || a.severity || '—'}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <footer className="py-10 text-center">
        <Link
          href="/dashboard"
          className="inline-flex items-center gap-1.5 bg-accent text-white text-sm font-medium rounded-full px-5 py-2.5 hover:bg-accent/90 transition-colors"
        >
          Open the dashboard
          <ArrowRight className="w-3.5 h-3.5" />
        </Link>
        <p className="mt-6 text-xs text-faint">46 threat patterns · rule engine v2 · policy engine v1</p>
      </footer>
    </main>
  );
}

function FeatureCard({ icon, title, body }) {
  return (
    <div className="bg-white border border-line rounded-xl p-6">
      <div className="w-9 h-9 rounded-full bg-accentSoft text-accent flex items-center justify-center mb-4">
        {icon}
      </div>
      <h3 className="font-display text-lg text-ink mb-2">{title}</h3>
      <p className="text-sm text-body leading-relaxed">{body}</p>
    </div>
  );
}

function LiveStat({ label, value }) {
  return (
    <div>
      <p className="font-display text-3xl text-ink">{value ?? '—'}</p>
      <p className="text-xs text-dim mt-1">{label}</p>
    </div>
  );
}
