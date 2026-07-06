'use client';

import React, { useState, useEffect, useMemo } from 'react';
import {
  Shield,
  Activity,
  ChevronDown,
  ExternalLink,
  Fingerprint,
  Copy,
  Check,
  Anchor,
  BrainCircuit,
} from 'lucide-react';

const displayFont = { fontFamily: "'Oswald', sans-serif" };
const monoFont = { fontFamily: "'IBM Plex Mono', monospace" };

const DEMO_GUARDIANS = [
  { id: 'wbot', name: 'WBOT', address: '0xD545...F4abd30', status: 'ACTIVE', scanned: 58, flagged: 3 },
  { id: 'usdt', name: 'USDT (testnet)', address: '0x75ed...10420fe3', status: 'ACTIVE', scanned: 41, flagged: 2 },
];

const SEVERITY_STYLE = {
  LOW: { bar: 'bg-stone-600', text: 'text-stone-400', label: 'CLEARED', badge: 'border-stone-700 text-stone-500' },
  MEDIUM: { bar: 'bg-amber-500', text: 'text-amber-400', label: 'MEDIUM', badge: 'border-amber-700/50 text-amber-500' },
  HIGH: { bar: 'bg-orange-600', text: 'text-orange-500', label: 'HIGH', badge: 'border-orange-700/50 text-orange-500' },
  CRITICAL: { bar: 'bg-red-600', text: 'text-red-500', label: 'CRITICAL', badge: 'border-red-700/50 text-red-500' },
};

const DEMO_ENTRIES = [
  {
    id: 'demo-1',
    token: 'WBOT',
    from: '0x7a3f...e2b1',
    to: '0x4c9d...19af',
    severity: 'CRITICAL',
    reason: 'Unlimited approval granted to a contract deployed 4 hours ago',
    rules: ['P002', 'P004', 'G002'],
    time: new Date(Date.now() - 2 * 60000).toISOString(),
    signed: true,
    hash: '0x9e21f7a8b3c04a2d5e6f8190c1d4a7b3e2f5c8d9a0b4e7f1c3d6a9b2e5f8c1d4',
    verdict: 'CRITICAL: This WBOT approval grants unlimited spending power. Immediate revocation is strongly recommended.',
    anchored: true,
    txHash: '0xabc123...',
  },
  {
    id: 'demo-2',
    token: 'USDT',
    from: '0x91cc...d02e',
    to: '0x5463...84E19',
    severity: 'LOW',
    reason: 'Standard approval, well within normal range',
    rules: [],
    time: new Date(Date.now() - 6 * 60000).toISOString(),
    signed: false,
    hash: null,
    verdict: null,
    anchored: false,
    txHash: null,
  },
  {
    id: 'demo-3',
    token: 'WBOT',
    from: '0x2b5a...771c',
    to: '0x88ff...20cd',
    severity: 'HIGH',
    reason: 'Approval amount is 40x this wallet\'s own token balance',
    rules: ['P001'],
    time: new Date(Date.now() - 11 * 60000).toISOString(),
    signed: true,
    hash: '0x114ab2c3d4e5f6789012345678901234567890abcdef1234567890abcdef1234',
    verdict: 'HIGH RISK: Approval amount is 40x this wallet\'s own token balance on WBOT. Review this approval before proceeding with any further transactions.',
    anchored: false,
    txHash: '0xdef456...',
  },
];

function timeAgo(iso) {
  if (!iso) return '—';
  const s = Math.floor((Date.now() - new Date(iso)) / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function GuardianCard({ g }) {
  return (
    <div className="border border-stone-800 bg-stone-900/60 rounded-sm p-3 hover:border-stone-700 transition-colors">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm tracking-wide uppercase" style={displayFont}>{g.name}</span>
        <span className="flex items-center gap-1 text-[10px] text-emerald-500 uppercase tracking-widest">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 inline-block animate-pulse" />
          {g.status}
        </span>
      </div>
      <div className="text-xs text-stone-500 truncate mb-2" style={monoFont}>{g.address}</div>
      <div className="flex items-center justify-between text-xs text-stone-400" style={monoFont}>
        <span>{g.scanned} scanned</span>
        <span className={g.flagged > 0 ? 'text-orange-500 font-medium' : 'text-stone-500'}>
          {g.flagged} flagged
        </span>
      </div>
    </div>
  );
}

function ManifestEntry({ entry, expanded, onToggle }) {
  const [copied, setCopied] = useState(false);
  const sev = SEVERITY_STYLE[entry.severity] || SEVERITY_STYLE.LOW;

  const handleCopy = async (e) => {
    e.stopPropagation();
    if (!entry.hash) return;
    try {
      await navigator.clipboard.writeText(entry.hash);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {}
  };

  const explorerUrl = entry.txHash
    ? `https://scan.bohr.life/tx/${entry.txHash}`
    : 'https://scan.bohr.life';

  return (
    <div className="border border-stone-800 bg-stone-900/40 rounded-sm overflow-hidden hover:border-stone-700 transition-colors">
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-stone-900/80 transition-colors"
      >
        <span className={`h-8 w-1.5 rounded-full shrink-0 ${sev.bar}`} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-0.5 flex-wrap">
            <span className="text-[10px] uppercase tracking-widest font-medium" style={displayFont}>
              {entry.token}
            </span>
            <span className={`text-[10px] uppercase tracking-widest ${sev.text}`}>
              {sev.label}
            </span>
            {entry.signed && entry.hash && (
              <span className="inline-flex items-center gap-1 -rotate-6 border border-orange-600/70 text-orange-500 text-[9px] uppercase tracking-widest px-1.5 py-0.5 rounded-sm shrink-0">
                <Fingerprint size={9} /> Signed
              </span>
            )}
            {entry.anchored && (
              <span className="inline-flex items-center gap-1 border border-emerald-700/50 text-emerald-500 text-[9px] uppercase tracking-widest px-1.5 py-0.5 rounded-sm shrink-0">
                <Anchor size={9} /> On-chain
              </span>
            )}
          </div>
          <p className="text-sm text-stone-300 truncate">{entry.reason}</p>
        </div>
        <div className="text-right shrink-0 pl-2">
          <div className="text-xs text-stone-500" style={monoFont}>{timeAgo(entry.time)}</div>
          <ChevronDown
            size={14}
            className={`ml-auto mt-1 text-stone-600 transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`}
          />
        </div>
      </button>

      {expanded && (
        <div className="px-3 pb-3 pt-1 border-t border-stone-800 space-y-2.5">
          <div className="flex items-center justify-between text-xs" style={monoFont}>
            <span className="text-stone-500">
              {entry.from} → {entry.to}
            </span>
          </div>

          {entry.rules.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {entry.rules.map((r) => (
                <span
                  key={r}
                  className="text-[10px] border border-stone-700 text-stone-400 px-1.5 py-0.5 rounded-sm"
                  style={monoFont}
                >
                  {r}
                </span>
              ))}
            </div>
          )}

          {entry.verdict && (
            <div className="bg-stone-950 border border-stone-800 rounded-sm px-2.5 py-2.5">
              <div className="flex items-center gap-1.5 mb-1.5">
                <BrainCircuit size={10} className="text-orange-500" />
                <span className="text-[10px] text-orange-500 uppercase tracking-widest">AI Verdict</span>
              </div>
              <p className="text-xs text-stone-300 leading-relaxed">{entry.verdict}</p>
              {entry.anchored && (
                <div className="flex items-center gap-1 mt-1.5">
                  <Anchor size={9} className="text-emerald-500" />
                  <span className="text-[10px] text-emerald-500">Anchored on-chain via ReceiptRegistry</span>
                </div>
              )}
            </div>
          )}

          {entry.signed && entry.hash ? (
            <div className="flex items-center justify-between bg-stone-950 border border-stone-800 rounded-sm px-2.5 py-2">
              <div className="min-w-0 flex-1">
                <div className="text-[10px] text-stone-500 uppercase tracking-widest mb-0.5">
                  Receipt hash
                </div>
                <div className="text-xs text-stone-300 truncate" style={monoFont}>
                  {entry.hash}
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0 pl-3">
                <button
                  onClick={handleCopy}
                  className="text-stone-500 hover:text-stone-300 transition-colors"
                  title="Copy hash"
                >
                  {copied ? <Check size={14} className="text-emerald-500" /> : <Copy size={14} />}
                </button>
                <a
                  href={explorerUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-1 text-[11px] text-orange-500 hover:text-orange-400 uppercase tracking-wide transition-colors"
                >
                  Verify <ExternalLink size={11} />
                </a>
              </div>
            </div>
          ) : (
            <p className="text-[11px] text-stone-600 italic">
              Not signed — below the anchoring threshold, logged for reference only.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

export default function ShieldGuardDashboard() {
  const [expandedId, setExpandedId] = useState(null);
  const [reduceMotion, setReduceMotion] = useState(false);
  const [entries, setEntries] = useState(DEMO_ENTRIES);
  const [guardians, setGuardians] = useState(DEMO_GUARDIANS);
  const [isLive, setIsLive] = useState(false);
  const [apiStatus, setApiStatus] = useState('connecting');
  const [signerAddress, setSignerAddress] = useState(null);

  const apiUrl = typeof window !== 'undefined'
    ? (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000')
    : 'http://localhost:4000';

  useEffect(() => {
    if (typeof window !== 'undefined' && window.matchMedia) {
      setReduceMotion(window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    }

    const fetchData = async () => {
      try {
        const [alertsRes, guardiansRes, healthRes] = await Promise.all([
          fetch(`${apiUrl}/alerts`),
          fetch(`${apiUrl}/guardians`),
          fetch(`${apiUrl}/health`),
        ]);

        if (alertsRes.ok && guardiansRes.ok) {
          const alerts = await alertsRes.json();
          const gData = await guardiansRes.json();
          const health = healthRes.ok ? await healthRes.json() : {};

          if (gData.length > 0) {
            setGuardians(gData);
            setEntries(alerts.length > 0 ? alerts : DEMO_ENTRIES);
            setIsLive(true);
            setApiStatus('connected');
          } else {
            setApiStatus('waiting');
          }

          if (health.signerAddress) {
            setSignerAddress(health.signerAddress);
          }
        } else {
          setApiStatus('error');
        }
      } catch (err) {
        console.error('Fetch failed:', err);
        setApiStatus('offline');
        setIsLive(false);
      }
    };

    fetchData();
    const interval = setInterval(fetchData, 5000);
    return () => clearInterval(interval);
  }, [apiUrl]);

  const flaggedCount = useMemo(() => entries.filter((e) => e.severity !== 'LOW').length, [entries]);
  const signedCount = useMemo(() => entries.filter((e) => e.signed).length, [entries]);
  const anchoredCount = useMemo(() => entries.filter((e) => e.anchored).length, [entries]);

  const statusColor = {
    connected: 'text-emerald-500',
    waiting: 'text-amber-500',
    error: 'text-red-500',
    offline: 'text-stone-500',
    connecting: 'text-stone-500',
  }[apiStatus];

  return (
    <div
      className="h-screen w-full flex flex-col bg-stone-950 text-stone-200 overflow-hidden"
      style={{ fontFamily: "'IBM Plex Sans', sans-serif" }}
    >
      {/* Header */}
      <header className="shrink-0 border-b border-stone-800 bg-stone-900 px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="h-8 w-8 rounded-sm border border-orange-600/60 flex items-center justify-center shrink-0">
            <Shield size={16} className="text-orange-500" />
          </div>
          <div>
            <div className="text-lg leading-none tracking-wide uppercase" style={displayFont}>
              ShieldGuard
            </div>
            <div className="text-[10px] text-stone-500 tracking-widest" style={monoFont}>
              UNIT SG-1 · RECORDER ONLINE
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <span className="hidden sm:inline text-[10px] text-stone-500 tracking-widest" style={monoFont}>
            BOT CHAIN · TESTNET 968
          </span>
          <span className={`flex items-center gap-1.5 text-[11px] uppercase tracking-widest ${statusColor}`}>
            <Activity size={12} className={reduceMotion ? '' : 'animate-pulse'} />
            {apiStatus === 'connected' ? 'LIVE' : apiStatus}
          </span>
        </div>
      </header>

      {/* Main */}
      <main className="flex-1 flex flex-col md:flex-row overflow-hidden">
        {/* Sidebar — Guardians + Stats */}
        <section className="md:w-64 shrink-0 border-b md:border-b-0 md:border-r border-stone-800 p-3 space-y-3 overflow-y-auto">
          <div className="text-[10px] text-stone-500 uppercase tracking-widest px-1" style={monoFont}>
            Guardians
          </div>
          {guardians.map((g) => (
            <GuardianCard key={g.id} g={g} />
          ))}

          <div className="border-t border-stone-800 pt-3 space-y-2">
            <div className="text-[10px] text-stone-500 uppercase tracking-widest px-1" style={monoFont}>
              Session Stats
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="border border-stone-800 bg-stone-900/40 rounded-sm p-2 text-center">
                <div className="text-lg text-orange-500" style={displayFont}>{flaggedCount}</div>
                <div className="text-[10px] text-stone-500 uppercase tracking-wider" style={monoFont}>Flagged</div>
              </div>
              <div className="border border-stone-800 bg-stone-900/40 rounded-sm p-2 text-center">
                <div className="text-lg text-orange-500" style={displayFont}>{signedCount}</div>
                <div className="text-[10px] text-stone-500 uppercase tracking-wider" style={monoFont}>Signed</div>
              </div>
              <div className="border border-stone-800 bg-stone-900/40 rounded-sm p-2 text-center">
                <div className="text-lg text-emerald-500" style={displayFont}>{anchoredCount}</div>
                <div className="text-[10px] text-stone-500 uppercase tracking-wider" style={monoFont}>Anchored</div>
              </div>
              <div className="border border-stone-800 bg-stone-900/40 rounded-sm p-2 text-center">
                <div className="text-lg text-stone-400" style={displayFont}>{entries.length}</div>
                <div className="text-[10px] text-stone-500 uppercase tracking-wider" style={monoFont}>Total</div>
              </div>
            </div>
          </div>

          {signerAddress && (
            <div className="border-t border-stone-800 pt-2">
              <div className="text-[10px] text-stone-500 uppercase tracking-widest px-1 mb-1" style={monoFont}>
                Signer
              </div>
              <div className="text-[10px] text-stone-600 truncate" style={monoFont}>
                {signerAddress}
              </div>
            </div>
          )}
        </section>

        {/* Manifest */}
        <section className="flex-1 overflow-y-auto p-3 space-y-2">
          <div className="flex items-center justify-between px-1 mb-1">
            <span className="text-[10px] text-stone-500 uppercase tracking-widest" style={monoFont}>
              Manifest — recent activity
            </span>
            <span className="text-[10px] text-orange-500 uppercase tracking-widest" style={monoFont}>
              {flaggedCount} flagged
            </span>
          </div>

          {entries.map((entry) => (
            <ManifestEntry
              key={entry.id}
              entry={entry}
              expanded={expandedId === entry.id}
              onToggle={() => setExpandedId(expandedId === entry.id ? null : entry.id)}
            />
          ))}

          {isLive && entries.length === 0 && (
            <div className="text-center py-12">
              <Activity size={24} className="text-stone-700 mx-auto mb-3" />
              <p className="text-xs text-stone-600">No events yet. Waiting for on-chain activity...</p>
            </div>
          )}

          {!isLive && (
            <div className="text-center py-8 border border-dashed border-stone-800 rounded-sm">
              <p className="text-xs text-stone-600 mb-1">Backend not connected</p>
              <p className="text-[10px] text-stone-700">Polling {apiUrl} every 5s...</p>
            </div>
          )}
        </section>
      </main>

      {/* Footer */}
      <footer className="shrink-0 border-t border-stone-800 bg-stone-900 px-4 py-1.5 flex items-center justify-between">
        <span className="text-[10px] text-stone-600 tracking-wide" style={monoFont}>
          33 threat patterns · rule engine v1 · policy engine v1
        </span>
        <span
          className={`text-[10px] border px-1.5 py-0.5 rounded-sm tracking-widest transition-colors ${
            isLive
              ? 'text-emerald-500 border-emerald-600/50'
              : 'text-amber-600 border-amber-700/50'
          }`}
        >
          {isLive ? 'LIVE DATA' : 'PREVIEW DATA'}
        </span>
      </footer>
    </div>
  );
}
