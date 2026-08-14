'use client';

import { useState } from 'react';
import { Play, CheckCircle2, XCircle, MinusCircle } from 'lucide-react';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';
const DEMO_SENDER = '0x71C7656EC7ab88b098defB751B7401B5f6d8976';

// Real calldata for real selectors validationOracle.js's hard-floor and
// simulation stages actually check. Not illustrative strings, this is
// exactly what gets POSTed to /api/oracle/evaluate.
const MAX_UINT256_HEX = 'f'.repeat(64);
const pad = (addr) => addr.replace(/^0x/, '').toLowerCase().padStart(64, '0');

const SCENARIOS = {
  prompt_hijack: {
    label: '1. Unlimited Spender Approval',
    tag: 'THREAT',
    tagline: 'Agent manipulated into granting unlimited ERC-20 allowance to an unknown address.',
    to: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
    method: 'approve(address,uint256)',
    data: '0x095ea7b3' + pad('0xd8dA6BF26964aF9D7eEd9e03E53415D37aA9604') + MAX_UINT256_HEX,
    badge: 'HIGH RISK',
    note: 'Hard floor rule, always blocks, no RPC dependency.',
  },
  proxy_upgrade: {
    label: '2. EIP-1967 Upgrade Exploit',
    tag: 'THREAT',
    tagline: 'Attempting to alter proxy storage slot 0x3608... to a malicious implementation contract.',
    to: '0x4e65Ec504eb80686815DEE541516016eD966cD3',
    method: 'upgradeToAndCall(address,bytes)',
    data: '0x4f1ef286' + pad('0x3f5CE5FBFe3E9af3971dD833D26BA9b5C936f0bE') + '0'.repeat(64),
    badge: 'CRITICAL',
    note: "Caught at the forked-state simulation stage, only if this server's RPC supports trace_call. Unverified on BOT Chain as of this build, see stateDiffExtractor.js.",
  },
  safe_swap: {
    label: '3. Verified DEX Swap',
    tag: 'VALID',
    tagline: 'Compliant swap transaction routed through a verified Uniswap V3 contract.',
    to: '0xE592427A0AEce92De3Edee1F18E0157C05861564',
    method: 'exactInputSingle(SwapParams)',
    data: '0x414bf389' + '00'.repeat(160),
    badge: 'VALID',
    note: 'No rule matches, passes hard floor and simulation, AI advisory, real oracle co-signature.',
  },
};

function buildSteps(res) {
  if (res.error) return { steps: [], error: res.error };

  const stage = res.stage;
  const blocked = res.decision === 'BLOCK';
  const flagged = res.decision === 'FLAG_REVIEW';

  const decodeStep = { status: 'pass', text: 'Selector decoded, calldata well-formed' };

  const floorBlocked = blocked && stage === 'hard_floor';
  const floorStep = {
    status: floorBlocked ? 'fail' : 'pass',
    text: floorBlocked ? `Hard policy floor: ${res.reason}` : 'Hard policy floor: no rule matched',
  };

  let simStep;
  if (stage === 'hard_floor') {
    simStep = { status: 'skip', text: 'Simulation skipped, already blocked at hard floor' };
  } else if (blocked && stage === 'simulation') {
    simStep = { status: 'fail', text: `Forked-state simulation: ${res.reason}` };
  } else if (res.simulationMode === 'eth_call_fallback' || res.simulationMode === 'simulation_failed') {
    simStep = { status: 'skip', text: `Simulation ran in fallback mode (${res.simulationMode}), storage-level checks unverified` };
  } else {
    simStep = { status: 'pass', text: 'Forked-state simulation: no unexpected storage mutation' };
  }

  let aiStep;
  if (stage === 'hard_floor' || (stage === 'simulation' && blocked)) {
    aiStep = { status: 'skip', text: 'AI advisory skipped, already blocked upstream' };
  } else if (stage === 'ai_advisory' && (blocked || flagged)) {
    aiStep = { status: 'fail', text: `AI advisory: ${res.reason}` };
  } else {
    aiStep = { status: 'pass', text: 'AI advisory: consistent with expected behavior' };
  }

  return { steps: [decodeStep, floorStep, simStep, aiStep], error: null };
}

const FALLBACK_T = {
  'debugger.label': 'Policy engine debugger',
  'debugger.title': 'Watch the pipeline decide.',
};

export default function PolicyDebugger({ t = (k) => FALLBACK_T[k] || k }) {
  const [key, setKey] = useState('prompt_hijack');
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState(null);
  const [revealed, setRevealed] = useState(0);

  const scenario = SCENARIOS[key];
  const built = result ? buildSteps(result) : { steps: [], error: null };

  function pick(nextKey) {
    setKey(nextKey);
    setResult(null);
    setRevealed(0);
  }

  async function run() {
    setRunning(true);
    setResult(null);
    setRevealed(0);
    try {
      const res = await fetch(`${API}/api/oracle/evaluate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sender: DEMO_SENDER,
          to: scenario.to,
          data: scenario.data,
          value: '0',
          context: { tokenName: scenario.label },
        }),
      });
      const json = await res.json();
      setResult(res.ok ? json : { error: json.error || `Request failed (${res.status})` });
    } catch (err) {
      setResult({ error: `Could not reach ${API}: ${err.message}` });
    } finally {
      setRunning(false);
      let i = 0;
      const id = setInterval(() => {
        i += 1;
        setRevealed(i);
        if (i >= 4) clearInterval(id);
      }, 220);
    }
  }

  return (
    <section className="py-16">
      <div className="max-w-5xl mx-auto px-5">
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-3 mb-8">
          <div>
            <p className="text-xs font-medium tracking-wide text-dim uppercase mb-2">{t('debugger.label')}</p>
            <h2 className="font-display text-2xl md:text-3xl text-ink leading-snug">{t('debugger.title')}</h2>
          </div>
          <p className="text-sm text-body max-w-sm">
            This calls your real <code className="font-mono">/api/oracle/evaluate</code> endpoint. Same hard-floor
            rules and AI advisory a real transaction gets, no scripted outcome.
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
          <div className="lg:col-span-5 space-y-4">
            <div className="bg-surface border border-line rounded-xl p-4 space-y-2">
              <p className="text-xs font-mono text-dim mb-1">SELECT A PAYLOAD</p>
              {Object.entries(SCENARIOS).map(([k, s]) => (
                <button
                  key={k}
                  onClick={() => pick(k)}
                  className={`w-full text-left p-3 rounded-lg border transition-colors ${
                    key === k ? 'border-accent bg-accentSoft' : 'border-line bg-paper hover:border-dim'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-mono font-medium text-ink">{s.label}</span>
                    <span
                      className={`text-[10px] font-mono px-1.5 py-0.5 rounded-full ${
                        s.tag === 'THREAT' ? 'text-critical bg-critical/10' : 'text-nominal bg-nominal/10'
                      }`}
                    >
                      {s.tag}
                    </span>
                  </div>
                  <p className="text-[11px] text-dim mt-1 leading-relaxed">{s.tagline}</p>
                </button>
              ))}
              <p className="text-[10px] text-faint pt-1 leading-relaxed">{scenario.note}</p>
            </div>

            <div className="bg-surface border border-line rounded-xl p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-mono text-dim">TO / METHOD / DATA</span>
                <span
                  className={`text-[10px] font-mono px-1.5 py-0.5 rounded-full ${
                    scenario.tag === 'THREAT' ? 'text-critical bg-critical/10' : 'text-nominal bg-nominal/10'
                  }`}
                >
                  {scenario.badge}
                </span>
              </div>
              <pre className="bg-surfaceAlt border border-line rounded-lg p-3 text-[11px] font-mono text-ink overflow-x-auto h-28 whitespace-pre-wrap break-all">
                {`to: ${scenario.to}\nmethod: ${scenario.method}\ndata: ${scenario.data.slice(0, 60)}...`}
              </pre>
              <button
                onClick={run}
                disabled={running}
                className="w-full mt-3 inline-flex items-center justify-center gap-1.5 py-2 rounded-full bg-accent text-white text-xs font-medium hover:bg-accent/90 transition-colors disabled:opacity-60"
              >
                <Play className="w-3 h-3" />
                {running ? 'Calling oracle…' : 'Execute simulation'}
              </button>
            </div>
          </div>

          <div className="lg:col-span-7">
            <div className="bg-surface border border-line rounded-xl p-5 h-full flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between border-b border-line pb-3 mb-4">
                  <span className="text-sm font-medium text-ink">
                    {!result ? 'Ready for execution trace' : running ? 'Calling oracle…' : 'Trace complete'}
                  </span>
                  <span className="text-xs font-mono text-faint">{revealed}/4 steps</span>
                </div>

                {built.error ? (
                  <div className="p-3 rounded-lg border border-caution/40 bg-caution/5 text-xs font-mono text-caution">
                    {built.error}
                  </div>
                ) : (
                  <div className="space-y-2">
                    {(built.steps.length ? built.steps : Array(4).fill({ status: 'pending', text: '' })).map((s, i) => {
                      const isRevealed = revealed > i;
                      return (
                        <div
                          key={i}
                          className={`flex items-center gap-2.5 p-2.5 rounded-lg border text-xs font-mono transition-opacity ${
                            !isRevealed
                              ? 'border-line bg-surfaceAlt opacity-40'
                              : s.status === 'fail'
                              ? 'border-critical/30 bg-critical/5 text-critical'
                              : s.status === 'skip'
                              ? 'border-line bg-surfaceAlt text-faint'
                              : 'border-nominal/30 bg-nominal/5 text-nominal'
                          }`}
                        >
                          {isRevealed ? (
                            s.status === 'fail' ? (
                              <XCircle className="w-3.5 h-3.5 flex-shrink-0" />
                            ) : s.status === 'skip' ? (
                              <MinusCircle className="w-3.5 h-3.5 flex-shrink-0" />
                            ) : (
                              <CheckCircle2 className="w-3.5 h-3.5 flex-shrink-0" />
                            )
                          ) : (
                            <span className="w-3.5 h-3.5 flex-shrink-0 rounded-full border border-faint" />
                          )}
                          <span>{isRevealed ? s.text : ''}</span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              <div className="mt-5 p-3 rounded-lg bg-surfaceAlt border border-line">
                <p className="text-[10px] font-mono text-dim uppercase tracking-wide mb-1">Oracle decision</p>
                {!result && <p className="text-sm text-dim">Pick a payload and run the simulation to see the verdict.</p>}
                {result && built.error && <p className="text-sm text-caution">Could not get a verdict, see above.</p>}
                {result && !built.error && revealed >= 4 && (
                  <>
                    <p
                      className={`text-sm font-medium ${
                        result.decision === 'BLOCK' ? 'text-critical' : result.decision === 'FLAG_REVIEW' ? 'text-caution' : 'text-nominal'
                      }`}
                    >
                      {result.decision} — {result.reason}
                    </p>
                    {result.oracleSignature && (
                      <p className="text-[10px] font-mono text-dim mt-1.5 break-all">
                        ECDSA sig: {result.oracleSignature.slice(0, 40)}... (valid until {result.validUntil})
                      </p>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
