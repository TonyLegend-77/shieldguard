'use client';

import { useEffect, useState } from 'react';
import { Radio, Search, ExternalLink, X } from 'lucide-react';

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

/**
 * The live/simulated threat feed — search, mode toggle, feed rows, AI
 * verdicts, signed-proof links, all of it. Extracted out of the landing
 * page (page.jsx) so it can be reused both as a teaser there and as the
 * full experience on its own dedicated /threats page.
 *
 * compact=true (used on the landing page): caps the live feed at 8 rows
 * with a "show all" toggle, matches the smaller max-w-3xl container it
 * used to live in.
 * compact=false (used on /threats): no cap, no truncation, feed just
 * grows and the page itself scrolls — this is the dedicated view.
 */
export default function ThreatFeed({ compact = false }) {
  const [feed, setFeed] = useState([]);
  const [mode, setMode] = useState('live'); // 'live' | 'simulated'
  const [simFeed, setSimFeed] = useState([]);
  const [expanded, setExpanded] = useState(false);
  const [query, setQuery] = useState('');
  const [searchResults, setSearchResults] = useState(null); // null = not searching
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    const loadFeed = () => {
      // Dedicated page pulls a much deeper history (250, matching the
      // earlier scrollable-feed work) since there's a whole page of room
      // for it; the compact landing-page teaser only needs enough to
      // cover its own 8-row cap plus headroom for "show all".
      const limit = compact ? 50 : 250;
      fetch(`${API}/api/alerts/global?limit=${limit}`)
        .then((r) => r.json())
        .then((data) => setFeed(Array.isArray(data) ? data : []))
        .catch(() => {});
    };
    loadFeed();
    const id = setInterval(loadFeed, 5000);
    return () => clearInterval(id);
  }, [compact]);

  // Searches contract name, contract address, tx hash, or content hash —
  // hits the backend so it covers full alert history, not just whatever's
  // in the local feed slice.
  useEffect(() => {
    if (!query.trim()) {
      setSearchResults(null);
      return;
    }
    setSearching(true);
    const id = setTimeout(() => {
      fetch(`${API}/api/alerts/global?q=${encodeURIComponent(query.trim())}&limit=${compact ? 100 : 250}`)
        .then((r) => r.json())
        .then((data) => setSearchResults(Array.isArray(data) ? data : []))
        .catch(() => setSearchResults([]))
        .finally(() => setSearching(false));
    }, 350);
    return () => clearTimeout(id);
  }, [query, compact]);

  // Simulated playback: cycles through SIMULATED_FEED one entry at a time,
  // clearly labeled as simulated (never presented as real data) — for
  // showing the product in action when there's no live flagged traffic to
  // point at.
  useEffect(() => {
    if (mode !== 'simulated') return;
    setSimFeed([]);
    let i = 0;
    const id = setInterval(() => {
      setSimFeed((prev) => [SIMULATED_FEED[i % SIMULATED_FEED.length], ...prev].slice(0, compact ? 8 : 50));
      i += 1;
    }, 2200);
    return () => clearInterval(id);
  }, [mode, compact]);

  const rows = mode === 'simulated' ? simFeed : searchResults !== null ? searchResults : feed;
  const visible = compact && mode === 'live' && searchResults === null && !expanded ? rows.slice(0, 8) : rows;

  return (
    <div>
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

      <div className={`border border-line bg-surface rounded-xl overflow-hidden ${compact ? '' : 'max-h-[70vh] flex flex-col'}`}>
        {mode === 'live' && searchResults !== null && (
          <p className="font-mono text-[10px] text-dim px-4 py-2 border-b border-line bg-surfaceAlt flex-shrink-0">
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
        <div className={`divide-y divide-line ${compact ? '' : 'overflow-y-auto'}`}>
          {visible.map((a, i) => (
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
              {a.verdict && (
                <div className="ml-3.5 font-mono text-[11px] text-accent bg-accentSoft rounded px-2.5 py-1.5 leading-relaxed">
                  AI verdict: {a.verdict}
                </div>
              )}
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
                  {mode === 'live' && a.anchored && a.hash && (
                    <a
                      href={`${API}/verify/${a.hash}`}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-critical font-medium hover:text-critical/80 transition-colors"
                      title="View the signed, on-chain receipt for this alert"
                    >
                      view signed proof
                      <ExternalLink className="w-2.5 h-2.5" />
                    </a>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
        {compact && mode === 'live' && searchResults === null && feed.length > 8 && (
          <button
            onClick={() => setExpanded((v) => !v)}
            className="w-full py-2.5 font-mono text-[11px] text-accent hover:bg-accentSoft transition-colors border-t border-line flex-shrink-0"
          >
            {expanded ? 'Show less' : `Show all ${feed.length}`}
          </button>
        )}
      </div>
    </div>
  );
}
