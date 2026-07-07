'use client';

import { useEffect, useState, useCallback } from 'react';
import {
  Shield,
  Radio,
  ChevronDown,
  PenLine,
  Link2,
  WifiOff,
  ExternalLink,
  Loader2,
  BadgeCheck,
} from 'lucide-react';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

const SEVERITY = {
  LOW: { label: 'NOMINAL', text: 'text-nominal', border: 'border-nominal' },
  MEDIUM: { label: 'ELEVATED', text: 'text-info', border: 'border-info' },
  HIGH: { label: 'HIGH', text: 'text-caution', border: 'border-caution' },
  CRITICAL: { label: 'CRITICAL', text: 'text-critical', border: 'border-critical' },
};

function short(addr) {
  if (!addr) return '—';
  if (addr.length <= 12) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function timeAgo(iso) {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export default function Page() {
  const [health, setHealth] = useState(null);
  const [guardians, setGuardians] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [online, setOnline] = useState(false);
  const [expanded, setExpanded] = useState(null);
  const [verifyState, setVerifyState] = useState({}); // hash -> { loading, data, error }

  const poll = useCallback(async () => {
    try {
      const [h, g, a] = await Promise.all([
        fetch(`${API}/health`).then((r) => r.json()),
        fetch(`${API}/guardians`).then((r) => r.json()),
        fetch(`${API}/alerts`).then((r) => r.json()),
      ]);
      setHealth(h);
      setGuardians(g);
      setAlerts(a);
      setOnline(true);
    } catch {
      setOnline(false);
    }
  }, []);

  useEffect(() => {
    poll();
    const id = setInterval(poll, 5000);
    return () => clearInterval(id);
  }, [poll]);

  const runVerify = async (hash) => {
    setVerifyState((s) => ({ ...s, [hash]: { loading: true } }));
    try {
      const res = await fetch(`${API}/verify/${hash}`);
      const data = await res.json();
      setVerifyState((s) => ({ ...s, [hash]: { loading: false, data } }));
    } catch (err) {
      setVerifyState((s) => ({ ...s, [hash]: { loading: false, error: err.message } }));
    }
  };

  const flagged = alerts.filter((a) => a.severity !== 'LOW').length;
  const signed = alerts.filter((a) => a.signed).length;
  const anchored = alerts.filter((a) => a.anchored).length;

  return (
    <main className="min-h-screen bg-grid bg-vignette">
      <div className="max-w-6xl mx-auto px-5 py-8 md:py-12">

        <header className="flex items-center justify-between border-b border-line pb-5 mb-8 animate-fadeUp">
          <div className="flex items-center gap-3">
            <Shield className="w-6 h-6 text-nominal shrink-0" strokeWidth={1.5} />
            <div>
              <h1 className="font-display text-sm md:text-base tracking-[0.15em] text-ink">
                SHIELDGUARD
              </h1>
              <p className="font-mono text-[11px] text-dim tracking-wide mt-0.5">
                UNIT SG-1 · BOT CHAIN · TESTNET 968
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 font-mono text-[11px] tracking-wide">
            {online ? (
              <>
                <span className="w-2 h-2 rounded-full bg-nominal animate-pulseDot" />
                <span className="text-nominal">LIVE</span>
              </>
            ) : (
              <>
                <WifiOff className="w-3.5 h-3.5 text-critical" />
                <span className="text-critical">OFFLINE</span>
              </>
            )}
          </div>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-[340px_1fr] gap-5">

          <section
            className="border border-line bg-panel rounded-sm overflow-hidden animate-fadeUp"
            style={{ animationDelay: '80ms' }}
          >
            <div className="relative overflow-hidden border-b border-line px-4 py-3">
              <div className="absolute inset-0 -z-0 overflow-hidden opacity-40">
                <div className="absolute top-0 bottom-0 w-24 bg-gradient-to-r from-transparent via-nominal/20 to-transparent animate-sweep" />
              </div>
              <h2 className="relative font-display text-[11px] tracking-[0.15em] text-dim">
                GUARDIANS
              </h2>
            </div>

            <div className="divide-y divide-line">
              {guardians.length === 0 && (
                <p className="font-mono text-xs text-faint px-4 py-6">
                  {online ? 'No contracts registered yet.' : 'Awaiting connection to sentinel.'}
                </p>
              )}
              {guardians.map((g) => (
                <div key={g.id} className="px-4 py-4">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="font-mono text-sm font-medium text-ink">{g.name}</span>
                    <span className="flex items-center gap-1.5 text-[10px] font-mono text-nominal">
                      <Radio className="w-3 h-3 animate-pulseDot" />
                      SCANNING
                    </span>
                  </div>
                  <p className="font-mono text-[11px] text-dim break-all mb-2">
                    {short(g.address)}
                  </p>
                  <div className="flex gap-4 font-mono text-[11px]">
                    <span className="text-dim">
                      SCANNED <span className="text-ink">{g.scanned}</span>
                    </span>
                    <span className="text-dim">
                      FLAGGED{' '}
                      <span className={g.flagged > 0 ? 'text-caution' : 'text-ink'}>
                        {g.flagged}
                      </span>
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section
            className="border border-line bg-panel rounded-sm overflow-hidden animate-fadeUp"
            style={{ animationDelay: '160ms' }}
          >
            <div className="border-b border-line px-4 py-3">
              <h2 className="font-display text-[11px] tracking-[0.15em] text-dim">
                MANIFEST — LIVE ACTIVITY
              </h2>
            </div>

            <div className="divide-y divide-line max-h-[560px] overflow-y-auto">
              {alerts.length === 0 && (
                <div className="px-5 py-10 text-center">
                  <p className="font-mono text-xs text-faint">
                    AWAITING FIRST SIGNAL — no events logged yet.
                  </p>
                </div>
              )}

              {alerts.map((a) => {
                const sev = SEVERITY[a.severity] || SEVERITY.LOW;
                const isOpen = expanded === a.id;
                const v = a.hash ? verifyState[a.hash] : null;

                return (
                  <div key={a.id} className={`border-l-2 ${sev.border} pl-4 pr-4 py-3.5`}>
                    <button
                      onClick={() => setExpanded(isOpen ? null : a.id)}
                      className="w-full flex items-start justify-between gap-3 text-left"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                          <span className={`font-mono text-[10px] tracking-wide ${sev.text}`}>
                            [{sev.label}]
                          </span>
                          <span className="font-mono text-xs text-ink">{a.token}</span>
                          {a.signed && <PenLine className="w-3 h-3 text-dim" />}
                          {a.anchored && <Link2 className="w-3 h-3 text-nominal" />}
                        </div>
                        <p className="font-sans text-[13px] text-dim leading-snug">
                          {a.reason}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0 pt-0.5">
                        <span className="font-mono text-[10px] text-faint whitespace-nowrap">
                          {timeAgo(a.time)}
                        </span>
                        <ChevronDown
                          className={`w-3.5 h-3.5 text-faint transition-transform ${isOpen ? 'rotate-180' : ''}`}
                        />
                      </div>
                    </button>

                    {isOpen && (
                      <div className="mt-3 pt-3 border-t border-line font-mono text-[11px] text-dim space-y-1.5">
                        <p>FROM &nbsp; {short(a.from)}</p>
                        <p>TO &nbsp;&nbsp;&nbsp; {short(a.to)}</p>
                        {a.rules?.length > 0 && <p>RULES &nbsp; {a.rules.join(', ')}</p>}
                        {a.verdict && <p className="text-ink">{a.verdict}</p>}
                        {a.hash && <p className="break-all">HASH &nbsp; {a.hash}</p>}

                        {a.anchored && a.hash && (
                          <div className="pt-2">
                            {!v && (
                              <button
                                onClick={() => runVerify(a.hash)}
                                className="inline-flex items-center gap-1.5 text-nominal border border-nominal/40 rounded-sm px-2.5 py-1 hover:bg-nominal/10 transition-colors"
                              >
                                <BadgeCheck className="w-3 h-3" />
                                VERIFY ON-CHAIN
                              </button>
                            )}

                            {v?.loading && (
                              <span className="inline-flex items-center gap-1.5 text-dim">
                                <Loader2 className="w-3 h-3 animate-spin" />
                                Querying ReceiptRegistry...
                              </span>
                            )}

                            {v?.data?.chain?.anchored && (
                              <div className="bg-raised border border-nominal/30 rounded-sm px-3 py-2.5 space-y-1.5">
                                <p className="text-nominal flex items-center gap-1.5">
                                  <BadgeCheck className="w-3 h-3" />
                                  CONFIRMED ON-CHAIN
                                </p>
                                {(() => {
                                  let onChainMsg = null;
                                  try {
                                    const parsed = JSON.parse(v.data.chain.metadata);
                                    onChainMsg = parsed.verdict || parsed.reason || null;
                                  } catch {
                                    onChainMsg = v.data.chain.metadata;
                                  }
                                  return onChainMsg ? (
                                    <p className="text-ink font-sans normal-case leading-snug pb-1 border-b border-line">
                                      {onChainMsg}
                                    </p>
                                  ) : null;
                                })()}
                                <p>SUBMITTER &nbsp; {short(v.data.chain.submitter)}</p>
                                <p>
                                  TIMESTAMP &nbsp;
                                  {new Date(v.data.chain.timestamp * 1000).toLocaleString()}
                                </p>
                                <a
                                  href={v.data.chain.explorerUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="inline-flex items-center gap-1 text-info hover:underline pt-1"
                                >
                                  View ReceiptRegistry on explorer
                                  <ExternalLink className="w-3 h-3" />
                                </a>
                              </div>
                            )}

                            {v?.data && !v.data.chain?.anchored && (
                              <p className="text-caution">
                                Not found on-chain yet — anchoring transaction may still be confirming.
                              </p>
                            )}

                            {v?.error && (
                              <p className="text-critical">Verification failed: {v.error}</p>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        </div>

        <footer
          className="mt-5 border border-line bg-panel rounded-sm px-5 py-4 flex flex-wrap items-center gap-x-8 gap-y-3 animate-fadeUp"
          style={{ animationDelay: '220ms' }}
        >
          <Stat label="FLAGGED" value={flagged} accent={flagged > 0 ? 'text-caution' : 'text-ink'} />
          <Stat label="SIGNED" value={signed} />
          <Stat label="ANCHORED" value={anchored} accent="text-nominal" />
          <Stat label="TOTAL" value={alerts.length} />
          <div className="ml-auto font-mono text-[11px] text-faint">
            SIGNER &nbsp;{short(health?.signerAddress)}
          </div>
        </footer>

        <p className="mt-4 font-mono text-[10px] text-faint text-center">
          33 threat patterns · rule engine v1 · policy engine v1
        </p>
      </div>
    </main>
  );
}

function Stat({ label, value, accent = 'text-ink' }) {
  return (
    <div>
      <p className="font-mono text-[10px] text-faint tracking-wide mb-0.5">{label}</p>
      <p className={`font-mono text-lg font-medium ${accent}`}>{value}</p>
    </div>
  );
}
