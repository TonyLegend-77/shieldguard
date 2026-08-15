'use client';

import { useEffect, useState } from 'react';
import { Radio, Search, ExternalLink, X } from 'lucide-react';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';
const EXPLORER_URL = process.env.NEXT_PUBLIC_EXPLORER_URL || 'https://scan.bohr.life';

// Both the compact (landing page) and full (/threats) feeds pull the same
// depth of real history now — 250 last-monitored transactions each. This
// used to be split 50/250 with a "simulated demo" toggle standing in for
// the compact view when live traffic was thin; the toggle and the fake
// data behind it are gone, this is live-only, always.
const FEED_LIMIT = 250;

// This is the "Live threat feed," so it should only ever show actual
// threats — LOW-risk entries (T002 dust, routine transfers with no rule
// matched, etc.) are recorded by the backend for the full alert history but
// aren't threats, so they're filtered out here before render.
const isThreat = (a) => (a.risk || a.severity || 'LOW') !== 'LOW';

/**
 * The live threat feed — search, feed rows, AI verdicts, signed-proof
 * links, all of it. Extracted out of the landing page (page.jsx) so it can
 * be reused both as a teaser there and as the full experience on its own
 * dedicated /threats page.
 *
 * compact=true (used on the landing page): caps the *visible* rows at 8
 * with a "show all" toggle, matches the smaller max-w-3xl container it
 * used to live in — but still fetches the full 250-deep history behind
 * that toggle, same as the full page.
 * compact=false (used on /threats): no cap, no truncation, feed just
 * grows and the page itself scrolls — this is the dedicated view.
 */
export default function ThreatFeed({ compact = false }) {
  const [feed, setFeed] = useState([]);
  const [expanded, setExpanded] = useState(false);
  const [query, setQuery] = useState('');
  const [searchResults, setSearchResults] = useState(null); // null = not searching
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    const loadFeed = () => {
      fetch(`${API}/api/alerts/global?limit=${FEED_LIMIT}`)
        .then((r) => r.json())
        .then((data) => setFeed(Array.isArray(data) ? data.filter(isThreat) : []))
        .catch(() => {});
    };
    loadFeed();
    const id = setInterval(loadFeed, 5000);
    return () => clearInterval(id);
  }, []);

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
      fetch(`${API}/api/alerts/global?q=${encodeURIComponent(query.trim())}&limit=${FEED_LIMIT}`)
        .then((r) => r.json())
        .then((data) => setSearchResults(Array.isArray(data) ? data.filter(isThreat) : []))
        .catch(() => setSearchResults([]))
        .finally(() => setSearching(false));
    }, 350);
    return () => clearTimeout(id);
  }, [query]);

  const rows = searchResults !== null ? searchResults : feed;
  const visible = compact && searchResults === null && !expanded ? rows.slice(0, 8) : rows;

  return (
    <div>
      <div className="flex items-center justify-center gap-3 mb-6 flex-wrap">
        <Radio className="w-4 h-4 text-nominal animate-pulse" />
        <h2 className="font-display text-lg text-ink">Live threat feed</h2>
      </div>

      <p className="text-center font-mono text-[10px] text-faint mb-3">
        polling every 5s · real production data · last {FEED_LIMIT} monitored transactions
      </p>

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

      <div className={`border border-line bg-surface rounded-xl overflow-hidden ${compact ? '' : 'max-h-[70vh] flex flex-col'}`}>
        {searchResults !== null && (
          <p className="font-mono text-[10px] text-dim px-4 py-2 border-b border-line bg-surfaceAlt flex-shrink-0">
            {searching ? 'Searching…' : `${searchResults.length} match${searchResults.length === 1 ? '' : 'es'} for "${query.trim()}"`}
          </p>
        )}
        {searchResults === null && feed.length === 0 && (
          <p className="font-mono text-xs text-faint px-4 py-8 text-center">
            No flagged activity in the current window — that&apos;s good news. This
            feed updates the moment something gets caught.
          </p>
        )}
        {searchResults !== null && !searching && searchResults.length === 0 && (
          <p className="font-mono text-xs text-faint px-4 py-8 text-center">
            No alerts match &quot;{query.trim()}&quot;.
          </p>
        )}
        <div className={`divide-y divide-line ${compact ? '' : 'overflow-y-auto'}`}>
          {visible.map((a, i) => (
            <div
              key={`${a.hash || a.txHash || i}-${i}`}
              className="px-4 py-3 flex flex-col gap-1.5 animate-fadeUp"
              style={{ animationDelay: `${Math.min(i, 8) * 40}ms` }}
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
                  {a.anchored && a.hash && (
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
        {compact && searchResults === null && feed.length > 8 && (
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
