'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Shield, Eye, FileSignature, KeyRound, ArrowRight, Radio, Search, ExternalLink, X } from 'lucide-react';
import PolicyDebugger from './components/PolicyDebugger';
import ThemeToggle from './components/ThemeToggle';
import LanguageToggle from './components/LanguageToggle';
import { useTheme } from './lib/theme';
import { useLanguage } from './lib/i18n';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';
const EXPLORER_URL = process.env.NEXT_PUBLIC_EXPLORER_URL || 'https://scan.bohr.life';

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
  const [expanded, setExpanded] = useState(false);
  const [query, setQuery] = useState('');
  const [searchResults, setSearchResults] = useState(null); // null = not searching
  const [searching, setSearching] = useState(false);
  const { theme, toggle } = useTheme();
  const { lang, setLang, t } = useLanguage();

  useEffect(() => {
    fetch(`${API}/api/stats/global`)
      .then((r) => r.json())
      .then(setStats)
      .catch(() => {});
  }, []);

  useEffect(() => {
    const loadFeed = () => {
      fetch(`${API}/api/alerts/global?limit=50`)
        .then((r) => r.json())
        .then((data) => setFeed(Array.isArray(data) ? data : []))
        .catch(() => {});
    };
    loadFeed();
    const id = setInterval(loadFeed, 5000);
    return () => clearInterval(id);
  }, []);

  // Searches contract name, contract address, tx hash, or content hash —
  // hits the backend so it covers full alert history (up to MAX_ALERTS),
  // not just whatever's in the local 50-item live feed.
  useEffect(() => {
    if (!query.trim()) {
      setSearchResults(null);
      return;
    }
    setSearching(true);
    const id = setTimeout(() => {
      fetch(`${API}/api/alerts/global?q=${encodeURIComponent(query.trim())}&limit=100`)
        .then((r) => r.json())
        .then((data) => setSearchResults(Array.isArray(data) ? data : []))
        .catch(() => setSearchResults([]))
        .finally(() => setSearching(false));
    }, 350);
    return () => clearTimeout(id);
  }, [query]);

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
          <div className="flex items-center gap-3">
            <LanguageToggle lang={lang} onChange={setLang} />
            <ThemeToggle theme={theme} onToggle={toggle} />
            <Link
              href="/dashboard"
              className="inline-flex items-center gap-1.5 bg-accent text-white text-sm font-medium rounded-full px-4 py-2 hover:bg-accent/90 transition-colors"
            >
              {t('nav.dashboard')}
            </Link>
          </div>
        </nav>

        {/* Hero */}
        <section className="pt-10 pb-16 text-center animate-fadeUp">
          <span className="inline-flex items-center gap-1.5 bg-accentSoft text-accent text-xs font-medium rounded-full px-3 py-1 mb-6">
            <span className="w-1.5 h-1.5 rounded-full bg-nominal" />
            {t('hero.badge')}
          </span>

          <h1 className="font-display text-4xl md:text-6xl leading-[1.1] text-ink mb-5">
            {t('hero.title1')}<br />{t('hero.title2')}
          </h1>

          <p className="max-w-xl mx-auto text-body text-base md:text-lg leading-relaxed mb-8">
            {t('hero.body')}
          </p>

          <div className="flex items-center justify-center gap-5">
            <Link
              href="/dashboard"
              className="inline-flex items-center gap-1.5 bg-accent text-white text-sm font-medium rounded-full px-5 py-2.5 hover:bg-accent/90 transition-colors"
            >
              {t('nav.dashboard')}
              <ArrowRight className="w-3.5 h-3.5" />
            </Link>
            <a
              href="https://github.com/TonyLegend-77/shieldguard"
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm font-medium text-ink hover:text-accent transition-colors"
            >
              {t('nav.source')} →
            </a>
          </div>
        </section>
      </div>

      {/* The problem */}
      <section className="bg-surfaceAlt py-16">
        <div className="max-w-5xl mx-auto px-5 grid grid-cols-1 md:grid-cols-[1fr_1.2fr] gap-8">
          <div>
            <p className="text-xs font-medium tracking-wide text-dim uppercase mb-2">{t('problem.label')}</p>
            <h2 className="font-display text-2xl md:text-3xl text-ink leading-snug">
              {t('problem.title')}
            </h2>
          </div>
          <p className="text-body leading-relaxed">
            {lang === 'en' ? (
              <>
                An unlimited <code className="font-mono text-sm bg-surface border border-line rounded px-1.5 py-0.5">approve()</code>{' '}
                or a blanket <code className="font-mono text-sm bg-surface border border-line rounded px-1.5 py-0.5">setApprovalForAll()</code>{' '}
                hands a stranger standing permission to drain a wallet — any time, without
                warning. AI agents make it worse: one prompt injection or hallucinated
                action, and a key with no supervision can move everything. Most tools
                only tell you after it's already gone.
              </>
            ) : (
              t('problem.body')
            )}
          </p>
        </div>
      </section>

      {/* How it watches */}
      <section className="py-16">
        <div className="max-w-5xl mx-auto px-5">
          <p className="text-xs font-medium tracking-wide text-dim uppercase mb-2 text-center">{t('how.label')}</p>
          <h2 className="font-display text-2xl md:text-3xl text-ink text-center mb-10">
            {t('how.title')}
          </h2>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            <FeatureCard
              icon={<Eye className="w-5 h-5" />}
              title={t('how.onchain.title')}
              body={t('how.onchain.body')}
            />
            <FeatureCard
              icon={<KeyRound className="w-5 h-5" />}
              title={t('how.presign.title')}
              body={t('how.presign.body')}
            />
            <FeatureCard
              icon={<FileSignature className="w-5 h-5" />}
              title={t('how.signed.title')}
              body={t('how.signed.body')}
            />
          </div>
        </div>
      </section>

      <PolicyDebugger t={t} />

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
                  mode === 'live' ? 'bg-surface text-ink shadow-sm' : 'text-faint hover:text-dim'
                }`}
              >
                LIVE
              </button>
              <button
                onClick={() => setMode('simulated')}
                className={`px-2.5 py-1 rounded-full transition-colors ${
                  mode === 'simulated' ? 'bg-surface text-ink shadow-sm' : 'text-faint hover:text-dim'
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

          {mode === 'live' && (
            <div className="relative mb-4">
              <Search className="w-3.5 h-3.5 text-faint absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search by contract name, address, or tx hash…"
                className="w-full bg-surface border border-line rounded-lg pl-9 pr-8 py-2 font-mono text-xs text-ink placeholder:text-faint focus:outline-none focus:border-accent/50"
              />
              {query && (
                <button
                  onClick={() => setQuery('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-faint hover:text-ink"
                  aria-label="Clear search"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          )}

          <div className="border border-line bg-surface rounded-xl overflow-hidden">
            {mode === 'live' && searchResults !== null && (
              <p className="font-mono text-[10px] text-dim px-4 py-2 border-b border-line bg-surfaceAlt">
                {searching ? 'Searching…' : `${searchResults.length} match${searchResults.length === 1 ? '' : 'es'} for "${query.trim()}"`}
              </p>
            )}
            {mode === 'live' && searchResults === null && feed.length === 0 && (
              <p className="font-mono text-xs text-faint px-4 py-8 text-center">
                No flagged activity in the current window — that&apos;s good news. This
                feed updates the moment something gets caught. Switch to the
                simulated demo above to see it in action.
              </p>
            )}
            {mode === 'live' && searchResults !== null && !searching && searchResults.length === 0 && (
              <p className="font-mono text-xs text-faint px-4 py-8 text-center">
                No alerts match &quot;{query.trim()}&quot;.
              </p>
            )}
            {mode === 'simulated' && simFeed.length === 0 && (
              <p className="font-mono text-xs text-faint px-4 py-8 text-center">
                Starting simulation…
              </p>
            )}
            <div className="divide-y divide-line">
              {(() => {
                const rows =
                  mode === 'simulated' ? simFeed : searchResults !== null ? searchResults : feed;
                const visible = mode === 'live' && searchResults === null && !expanded ? rows.slice(0, 8) : rows;
                return visible.map((a, i) => (
                  <div
                    key={`${mode}-${a.hash || a.txHash || i}-${i}`}
                    className="px-4 py-3 flex flex-col gap-1.5 animate-fadeUp"
                    style={{ animationDelay: mode === 'live' ? `${Math.min(i, 8) * 40}ms` : '0ms' }}
                  >
                    <div className="flex items-center justify-between gap-3">
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
                    {(a.tokenAddress || a.txHash) && (
                      <div className="flex items-center gap-3 pl-3.5 font-mono text-[10px] text-faint flex-wrap">
                        {a.tokenAddress && (
                          <span title={a.tokenAddress}>{a.tokenAddress.slice(0, 6)}…{a.tokenAddress.slice(-4)}</span>
                        )}
                        {a.txHash && (
                          <a
                            href={`${EXPLORER_URL}/tx/${a.txHash}`}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 hover:text-accent transition-colors"
                            title={a.txHash}
                          >
                            tx {a.txHash.slice(0, 6)}…{a.txHash.slice(-4)}
                            <ExternalLink className="w-2.5 h-2.5" />
                          </a>
                        )}
                        <span className={a.anchored ? 'text-nominal' : 'text-faint'}>
                          {a.anchored ? '● confirmed on-chain' : a.signed ? '○ signed, not yet anchored' : '○ not signed'}
                        </span>
                      </div>
                    )}
                  </div>
                ));
              })()}
            </div>
            {mode === 'live' && searchResults === null && feed.length > 8 && (
              <button
                onClick={() => setExpanded((v) => !v)}
                className="w-full py-2.5 font-mono text-[11px] text-accent hover:bg-accentSoft transition-colors border-t border-line"
              >
                {expanded ? 'Show less' : `Show all ${feed.length}`}
              </button>
            )}
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
    <div className="bg-surface border border-line rounded-xl p-6">
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
