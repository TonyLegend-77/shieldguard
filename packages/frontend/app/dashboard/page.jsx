'use client';

import { useEffect, useState } from 'react';
import { Shield, Search, Network, GitBranch, Microscope, Plus, Zap } from 'lucide-react';
import TopologyGraph from '../components/os/TopologyGraph';
import CommandPalette from '../components/os/CommandPalette';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';
const DEMO_SENDER = '0x71C7656EC7ab88b098defB751B7401B5f6d8976';

// Real calldata, same as the landing page's policy debugger. See that
// component's header comment for how these were built.
const MAX_UINT256_HEX = 'f'.repeat(64);
const pad = (addr) => addr.replace(/^0x/, '').toLowerCase().padStart(64, '0');
const PAYLOADS = {
  uniswap: {
    to: '0xE592427A0AEce92De3Edee1F18E0157C05861564',
    data: '0x414bf389' + '00'.repeat(160),
    label: 'Verified DEX swap',
  },
  exploit: {
    to: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
    data: '0x095ea7b3' + pad('0xd8dA6BF26964aF9D7eEd9e03E53415D37aA9604') + MAX_UINT256_HEX,
    label: 'Unlimited spender approval',
  },
};

// Agent swarm has no real session-tracking backend yet, this stays
// explicitly labeled demo data until that's built.
const AGENTS = [
  { name: 'Arbitrage-Bot-Alpha', session: '0x88f2...3b10', status: 'PASSIVE_LOOKUP', tone: 'emerald' },
  { name: 'Rebalancing-Agent-Beta', session: '0x14a9...e8d2', status: 'EVALUATING_OP', tone: 'amber', pulse: true },
  { name: 'Treasury-Manager-Gamma', session: '0xd90e...7f4a', status: 'STANDBY', tone: 'zinc' },
];

const TONE_TEXT = { emerald: 'text-emerald-400', amber: 'text-amber-400', zinc: 'text-zinc-500' };

export default function Dashboard() {
  const [circuitArmed, setCircuitArmed] = useState(true);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [rules, setRules] = useState([]);
  const [rulesError, setRulesError] = useState(null);
  const [graphMode, setGraphMode] = useState('idle');
  const [canvasStatus, setCanvasStatus] = useState({ text: 'Idle — awaiting UserOp payload', tone: 'text-zinc-500' });
  const [interp, setInterp] = useState({
    floor: { text: 'IDLE', tone: 'text-zinc-500' },
    ai: { text: 'IDLE', tone: 'text-zinc-500' },
    simulation: { text: 'IDLE', tone: 'text-zinc-500' },
  });
  const [footerLog, setFooterLog] = useState('System ready. Listening for UserOps across active agents...');
  const [coSign, setCoSign] = useState({ status: 'idle', sig: null });

  useEffect(() => {
    fetch(`${API}/api/policy/rules`)
      .then((r) => r.json())
      .then(setRules)
      .catch((err) => setRulesError(err.message));
  }, []);

  function compileRule(text) {
    // Local-only preview. There's no NL-to-rule compiler backend yet —
    // this adds a card to the list but does not change what
    // /api/oracle/evaluate actually enforces.
    setRules((prev) => [...prev, { id: `PREVIEW-${prev.length}`, tier: 'preview', target: null, assertion: text }]);
    setFooterLog(`Rule drafted locally (preview only, not enforced): "${text.slice(0, 48)}${text.length > 48 ? '…' : ''}"`);
    setPaletteOpen(false);
  }

  async function runSimulation(mode) {
    setGraphMode(mode);
    setCanvasStatus({ text: 'Calling /api/oracle/evaluate…', tone: 'text-zinc-400' });
    setInterp({
      floor: { text: 'RUNNING', tone: 'text-zinc-400' },
      ai: { text: 'RUNNING', tone: 'text-zinc-400' },
      simulation: { text: 'RUNNING', tone: 'text-zinc-400' },
    });
    const payload = PAYLOADS[mode];
    try {
      const res = await fetch(`${API}/api/oracle/evaluate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sender: DEMO_SENDER, to: payload.to, data: payload.data, value: '0', context: { tokenName: payload.label } }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `Request failed (${res.status})`);

      const blocked = json.decision === 'BLOCK';
      setCanvasStatus({
        text: `${json.decision} — ${json.reason}`,
        tone: blocked ? 'text-rose-400' : 'text-emerald-400',
      });
      setInterp({
        floor: {
          text: json.stage === 'hard_floor' && blocked ? 'FAIL' : 'PASS',
          tone: json.stage === 'hard_floor' && blocked ? 'text-rose-400' : 'text-emerald-400',
        },
        simulation: {
          text: json.simulationMode ? json.simulationMode.toUpperCase() : 'SKIPPED',
          tone:
            json.stage === 'simulation' && blocked
              ? 'text-rose-400'
              : json.simulationMode === 'eth_call_fallback' || json.simulationMode === 'simulation_failed'
              ? 'text-amber-400'
              : 'text-emerald-400',
        },
        ai: {
          text: json.stage === 'ai_advisory' ? (blocked ? 'FLAGGED' : 'REVIEWED') : json.stage === 'hard_floor' ? 'SKIPPED' : 'PASS',
          tone: json.stage === 'ai_advisory' && blocked ? 'text-rose-400' : 'text-emerald-400',
        },
      });
      setFooterLog(`${json.decision} at stage "${json.stage}": ${json.reason}`);

      if (!blocked && json.oracleSignature) {
        setCoSign({ status: 'done', sig: `${json.oracleSignature.slice(0, 40)}... (valid until ${json.validUntil})` });
      }
    } catch (err) {
      setCanvasStatus({ text: `Request failed: ${err.message}`, tone: 'text-amber-400' });
      setFooterLog(`Oracle call failed: ${err.message}`);
    }
  }

  async function coSignPayload() {
    setCoSign({ status: 'signing', sig: null });
    await runSimulation('uniswap');
    setCoSign((prev) => (prev.status === 'signing' ? { status: 'idle', sig: null } : prev));
  }


  return (
    <div className="sg-os min-h-screen flex flex-col justify-between bg-zinc-950 text-zinc-300 selection:bg-zinc-800 selection:text-emerald-400">
      <style jsx global>{`
        .sg-os {
          font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
        }
        .sg-os .font-mono {
          font-family: 'JetBrains Mono', ui-monospace, monospace;
        }
        .sg-os .font-sans {
          font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
        }
      `}</style>
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} onCompile={compileRule} />

      {/* Top status bar */}
      <header className="border-b border-zinc-800/80 bg-zinc-950 px-4 py-2 text-xs font-mono text-zinc-400 flex items-center justify-between sticky top-0 z-40">
        <div className="flex items-center space-x-4">
          <div className="flex items-center space-x-2">
            <div className="w-5 h-5 rounded bg-zinc-100 text-zinc-950 flex items-center justify-center">
              <Shield className="w-3 h-3" strokeWidth={2.5} />
            </div>
            <span className="font-semibold text-zinc-100 tracking-tight font-sans">ShieldGuard OS</span>
          </div>
          <span className="text-zinc-700">|</span>
          <div className="hidden lg:flex items-center space-x-3 text-[11px]">
            <span className="flex items-center space-x-1 text-emerald-400">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              <span>Helios light client: syncing</span>
            </span>
            <span className="text-zinc-700">&bull;</span>
            <span className="text-zinc-400">
              Rule engine: <strong className="text-zinc-200 font-normal">v2 live</strong>
            </span>
          </div>
        </div>

        <div className="flex items-center space-x-3 text-xs">
          <button
            onClick={() => setPaletteOpen(true)}
            className="px-2.5 py-1 rounded bg-zinc-900 border border-zinc-800 hover:border-zinc-700 text-zinc-300 flex items-center space-x-2 font-mono text-[11px]"
          >
            <Search className="w-3 h-3 text-zinc-500" />
            <span>NL Compiler</span>
            <kbd className="px-1 py-0.5 bg-zinc-950 border border-zinc-800 rounded text-[9px] text-zinc-400">⌘K</kbd>
          </button>
          <button
            onClick={() => setCircuitArmed((v) => !v)}
            className={`px-2.5 py-1 rounded border font-mono text-[11px] flex items-center space-x-1.5 ${
              circuitArmed
                ? 'bg-rose-500/10 border-rose-500/30 text-rose-400 hover:bg-rose-500/20'
                : 'bg-zinc-800 border-zinc-700 text-zinc-400 hover:bg-zinc-700'
            }`}
          >
            <span className={`w-1.5 h-1.5 rounded-full ${circuitArmed ? 'bg-rose-500' : 'bg-zinc-500'}`} />
            <span>Circuit breaker: {circuitArmed ? 'ARMED' : 'DISARMED'}</span>
          </button>
        </div>
      </header>

      {/* Workspace */}
      <main className="flex-1 max-w-[1700px] w-full mx-auto p-3 lg:p-4 grid grid-cols-1 lg:grid-cols-12 gap-4">

        {/* Column 1: agent swarm + policy rules */}
        <section className="lg:col-span-3 flex flex-col space-y-4">
          <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-3 space-y-3 font-mono text-xs">
            <div className="flex justify-between items-center border-b border-zinc-800 pb-2">
              <span className="font-semibold text-zinc-200 flex items-center space-x-1.5">
                <Network className="w-3.5 h-3.5 text-cyan-400" />
                <span>Active agent swarm</span>
              </span>
              <span className="px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400 border border-zinc-700 text-[10px]" title="No session-tracking backend yet — see chat notes">
                DEMO DATA
              </span>
            </div>
            <div className="space-y-2 text-[11px]">
              {AGENTS.map((a) => (
                <div key={a.name} className="p-2 rounded bg-zinc-950 border border-zinc-800 flex justify-between items-center">
                  <div>
                    <div className="text-zinc-200 font-medium">{a.name}</div>
                    <div className="text-zinc-500 text-[10px]">Session: {a.session}</div>
                  </div>
                  <span className={`text-[10px] ${TONE_TEXT[a.tone]} ${a.pulse ? 'animate-pulse' : ''}`}>{a.status}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-3 flex-1 flex flex-col justify-between font-mono text-xs space-y-3">
            <div>
              <div className="flex justify-between items-center border-b border-zinc-800 pb-2 mb-2">
                <span className="font-semibold text-zinc-200 flex items-center space-x-1.5">
                  <GitBranch className="w-3.5 h-3.5 text-purple-400" />
                  <span>Active policy rules</span>
                </span>
                <span className="text-[10px] text-zinc-500">Live from /api/policy/rules</span>
              </div>
              <div className="space-y-2 text-[11px] max-h-[380px] overflow-y-auto pr-1">
                {rulesError && (
                  <div className="p-2 rounded bg-rose-950/20 border border-rose-900/40 text-rose-400 text-[10px]">
                    Could not load rules: {rulesError}
                  </div>
                )}
                {rules.map((r) => (
                  <div
                    key={r.id}
                    className={`p-2 rounded bg-zinc-950 border ${
                      r.tier === 'preview' ? 'border-cyan-500/30 bg-cyan-950/10' : 'border-zinc-800/80'
                    }`}
                  >
                    <div className={`font-semibold mb-0.5 ${r.tier === 'preview' ? 'text-cyan-400' : 'text-purple-400'}`}>
                      {r.id} {r.tier === 'preview' ? '(preview, not enforced)' : `— ${r.tier}`}
                    </div>
                    {r.target && (
                      <div className="text-zinc-400">
                        Target: <span className="text-zinc-200">{r.target}</span>
                      </div>
                    )}
                    <div className="text-zinc-500 text-[10px] mt-1">{r.assertion}</div>
                  </div>
                ))}
              </div>
            </div>
            <button
              onClick={() => setPaletteOpen(true)}
              className="w-full py-2 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-sans transition-colors flex items-center justify-center space-x-2"
            >
              <Plus className="w-3 h-3" />
              <span>Draft new rule (preview only)</span>
            </button>
          </div>
        </section>

        {/* Column 2: topology graph + payload stream */}
        <section className="lg:col-span-6 flex flex-col space-y-4">
          <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-4 relative flex flex-col justify-between min-h-[380px] overflow-hidden">
            <div className="flex items-center justify-between border-b border-zinc-800/80 pb-2 z-10">
              <div className="flex items-center space-x-2">
                <Network className="w-3.5 h-3.5 text-emerald-400" />
                <span className="font-mono text-xs font-semibold text-zinc-100">Live EVM state topology</span>
              </div>
              <div className="flex items-center space-x-3 text-[11px] font-mono">
                <span className="text-zinc-500">
                  Fork: <strong className="text-zinc-300 font-normal">Mainnet #21940112</strong>
                </span>
              </div>
            </div>

            <div className="relative w-full h-[280px] my-2">
              <TopologyGraph mode={graphMode} />
              <div className="absolute bottom-2 left-2 px-2 py-1 bg-zinc-950/80 border border-zinc-800 rounded font-mono text-[10px] text-zinc-400">
                Nodes: <span className="text-emerald-400">Agent account</span> →{' '}
                <span className="text-cyan-400">ShieldGuard module</span> → <span className="text-purple-400">Target contract</span>
              </div>
            </div>

            <div className="flex items-center justify-between pt-2 border-t border-zinc-800/80 font-mono text-xs z-10">
              <div className="flex space-x-2">
                <button
                  onClick={() => runSimulation('uniswap')}
                  className="px-2.5 py-1 rounded bg-zinc-950 border border-zinc-800 hover:border-zinc-700 text-zinc-300 text-[11px]"
                >
                  Simulate swap payload
                </button>
                <button
                  onClick={() => runSimulation('exploit')}
                  className="px-2.5 py-1 rounded bg-zinc-950 border border-zinc-800 hover:border-zinc-700 text-rose-400 text-[11px]"
                >
                  Simulate hijack payload
                </button>
              </div>
              <span className={`${canvasStatus.tone} text-[11px]`}>{canvasStatus.text}</span>
            </div>
          </div>

          <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-3 font-mono text-xs space-y-2">
            <div className="flex justify-between items-center text-zinc-400">
              <span>Inbound UserOp payload stream</span>
              <span className="text-[10px] text-zinc-500">example format, not a live bundler feed</span>
            </div>
            <div className="p-3 bg-zinc-950 rounded border border-zinc-800/90 text-[11px] text-zinc-300 space-y-1 overflow-x-auto">
              <div>
                <span className="text-zinc-500">sender:</span>{' '}
                <span className="text-emerald-300">0x742d35Cc6634C0532925a3b844Bc454e4438f44e</span>
              </div>
              <div>
                <span className="text-zinc-500">callData:</span>{' '}
                <span className="text-zinc-400">0x5ae40101000000000000000000000000a0b86991c6218b36c1d19d4a2e9eb0ce3606eb48...</span>
              </div>
              <div className="flex justify-between text-zinc-500 pt-1 border-t border-zinc-900 text-[10px]">
                <span>maxFeePerGas: 18.2 Gwei</span>
                <span>verificationGasLimit: 120,000</span>
                <span>nonce: 42</span>
              </div>
            </div>
          </div>
        </section>

        {/* Column 3: interpretability + co-sign */}
        <section className="lg:col-span-3 flex flex-col space-y-4">
          <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-3 space-y-3 font-mono text-xs">
            <div className="flex justify-between items-center border-b border-zinc-800 pb-2">
              <span className="font-semibold text-zinc-200 flex items-center space-x-1.5">
                <Microscope className="w-3.5 h-3.5 text-amber-400" />
                <span>Interpretability matrix</span>
              </span>
              <span className="text-[10px] text-amber-400/90 bg-amber-500/10 px-1.5 py-0.5 rounded border border-amber-500/20">
                REASONING TRACE
              </span>
            </div>
            <div className="space-y-2 text-[11px]">
              <div className="p-2 rounded bg-zinc-950 border border-zinc-800">
                <div className="text-zinc-400 flex justify-between">
                  <span>Hard policy floor</span>
                  <span className={`font-bold ${interp.floor.tone}`}>{interp.floor.text}</span>
                </div>
                <div className="text-zinc-500 text-[10px] mt-0.5">Deterministic rule checks, no AI involved.</div>
              </div>
              <div className="p-2 rounded bg-zinc-950 border border-zinc-800">
                <div className="text-zinc-400 flex justify-between">
                  <span>Forked-state simulation</span>
                  <span className={`font-bold ${interp.simulation.tone}`}>{interp.simulation.text}</span>
                </div>
                <div className="text-zinc-500 text-[10px] mt-0.5">EIP-1967 slot + balance-delta check.</div>
              </div>
              <div className="p-2 rounded bg-zinc-950 border border-zinc-800">
                <div className="text-zinc-400 flex justify-between">
                  <span>AI advisory</span>
                  <span className={`font-bold ${interp.ai.tone}`}>{interp.ai.text}</span>
                </div>
                <div className="text-zinc-500 text-[10px] mt-0.5">Payload compared against expected behavior.</div>
              </div>
            </div>
          </div>

          <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-3 flex-1 flex flex-col justify-between font-mono text-xs space-y-3">
            <div>
              <div className="flex justify-between items-center border-b border-zinc-800 pb-2 mb-2">
                <span className="font-semibold text-zinc-200">Oracle co-signature</span>
                <span className="text-[10px] text-zinc-500">ECDSA</span>
              </div>
              <div className="p-2.5 rounded bg-zinc-950 border border-zinc-800 space-y-2">
                <div className="text-[10px] text-zinc-500 uppercase tracking-wider">Status</div>
                <div className="text-zinc-300 text-[11px]">
                  {coSign.status === 'idle' && 'Awaiting validation trace...'}
                  {coSign.status === 'signing' && 'Signing UserOp hash...'}
                  {coSign.status === 'done' && 'Co-signature issued.'}
                </div>
                {coSign.sig && (
                  <div className="text-[10px] text-zinc-500 break-all font-mono bg-zinc-900 p-1.5 rounded border border-zinc-800/60">
                    {coSign.sig}
                  </div>
                )}
              </div>
            </div>
            <button
              onClick={coSignPayload}
              disabled={coSign.status === 'signing'}
              className="w-full py-2 rounded bg-emerald-500 hover:bg-emerald-400 text-zinc-950 font-medium font-sans transition-colors text-xs flex items-center justify-center space-x-2 disabled:opacity-60"
            >
              <Zap className="w-3 h-3" />
              <span>{coSign.status === 'signing' ? 'Signing…' : 'Generate co-signature'}</span>
            </button>
          </div>
        </section>
      </main>

      {/* Footer log */}
      <footer className="border-t border-zinc-800/80 bg-zinc-950 px-4 py-2 font-mono text-xs text-zinc-500 flex flex-col md:flex-row justify-between items-center gap-2">
        <div className="flex items-center space-x-3">
          <span className="flex items-center space-x-1 text-zinc-400">
            <span className="w-2 h-2 rounded-full bg-emerald-500" />
            <span>Oracle co-signer node</span>
          </span>
          <span className="text-zinc-800">|</span>
          <span className="text-zinc-400">{footerLog}</span>
        </div>
        <div className="flex items-center space-x-4 text-[11px]">
          <span>
            Helios light client: <strong className="text-zinc-300 font-normal">syncing</strong>
          </span>
        </div>
      </footer>
    </div>
  );
}
