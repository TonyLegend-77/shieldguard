'use client';

import { useState } from 'react';
import { FlaskConical, Loader2, ShieldCheck, ShieldAlert, ShieldX } from 'lucide-react';
import { encodeApprove, encodeApprovalForAll, encodeTransfer, MAX_UINT256 } from '../lib/calldata';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

const SCENARIOS = {
  unlimited_approve: {
    label: 'Unlimited approve()',
    needsSpender: true,
    build: (spender) => encodeApprove(spender, MAX_UINT256),
  },
  oversized_approve: {
    label: 'Approval > 10x balance',
    needsSpender: true,
    // A large fixed amount — evaluateApproval compares against the real
    // on-chain balance of `from` at `to`, fetched server-side.
    build: (spender) => encodeApprove(spender, 1_000_000n * 10n ** 18n),
  },
  approval_for_all: {
    label: 'Blanket setApprovalForAll (NFT)',
    needsSpender: true,
    spenderLabel: 'Operator address',
    build: (operator) => encodeApprovalForAll(operator, true),
  },
  plain_transfer: {
    label: 'Plain transfer()',
    needsSpender: true,
    spenderLabel: 'Recipient address',
    build: (to) => encodeTransfer(to, 1n * 10n ** 18n),
  },
  custom: {
    label: 'Custom raw calldata',
    needsSpender: false,
    build: null,
  },
};

const ADDR_RE = /^0x[a-fA-F0-9]{40}$/;

function ResultBadge({ recommendation }) {
  if (recommendation === 'REVOKE_IMMEDIATELY') {
    return (
      <span className="inline-flex items-center gap-1.5 text-critical">
        <ShieldX className="w-4 h-4" /> BLOCKED
      </span>
    );
  }
  if (recommendation === 'REVIEW_AND_REVOKE') {
    return (
      <span className="inline-flex items-center gap-1.5 text-caution">
        <ShieldAlert className="w-4 h-4" /> FLAGGED FOR REVIEW
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-nominal">
      <ShieldCheck className="w-4 h-4" /> APPROVED
    </span>
  );
}

export default function SdkTester({ wallet }) {
  const [scenario, setScenario] = useState('unlimited_approve');
  const [from, setFrom] = useState(wallet?.address || '');
  const [to, setTo] = useState('');
  const [spender, setSpender] = useState('');
  const [customData, setCustomData] = useState('0x');
  const [status, setStatus] = useState(null); // null | 'loading' | 'error'
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  const cfg = SCENARIOS[scenario];

  const run = async (e) => {
    e.preventDefault();
    setError(null);
    setResult(null);

    const fromAddr = from || wallet?.address;
    if (!fromAddr || !ADDR_RE.test(fromAddr)) return setError('Enter a valid "from" address.');
    if (!to || !ADDR_RE.test(to)) return setError('Enter a valid "to" (target contract) address.');

    let data;
    if (scenario === 'custom') {
      data = customData;
    } else {
      if (!spender || !ADDR_RE.test(spender)) return setError(`Enter a valid ${cfg.spenderLabel || 'spender address'}.`);
      data = cfg.build(spender);
    }

    setStatus('loading');
    try {
      const res = await fetch(`${API}/api/validate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: fromAddr, to, value: '0', data }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Validation request failed');
      setResult(json);
      setStatus(null);
    } catch (err) {
      setError(err.message);
      setStatus(null);
    }
  };

  return (
    <section className="border border-line bg-surface rounded-xl overflow-hidden animate-fadeUp">
      <div className="border-b border-line px-4 py-3 flex items-center gap-2">
        <FlaskConical className="w-3.5 h-3.5 text-dim" />
        <h2 className="font-display text-sm text-ink">
          SDK pre-signing tester — /api/validate
        </h2>
      </div>

      <form onSubmit={run} className="px-4 py-4 space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <select
            value={scenario}
            onChange={(e) => setScenario(e.target.value)}
            className="bg-white border border-line rounded-lg px-2.5 py-1.5 font-mono text-xs text-ink focus:outline-none focus:border-accent/50"
          >
            {Object.entries(SCENARIOS).map(([key, s]) => (
              <option key={key} value={key}>{s.label}</option>
            ))}
          </select>

          <input
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            placeholder="From address (defaults to connected wallet)"
            className="bg-white border border-line rounded-lg px-2.5 py-1.5 font-mono text-xs text-ink placeholder:text-faint focus:outline-none focus:border-accent/50"
          />

          <input
            value={to}
            onChange={(e) => setTo(e.target.value)}
            placeholder="To — target contract address"
            className="bg-white border border-line rounded-lg px-2.5 py-1.5 font-mono text-xs text-ink placeholder:text-faint focus:outline-none focus:border-accent/50"
          />

          {cfg.needsSpender ? (
            <input
              value={spender}
              onChange={(e) => setSpender(e.target.value)}
              placeholder={cfg.spenderLabel || 'Spender address'}
              className="bg-white border border-line rounded-lg px-2.5 py-1.5 font-mono text-xs text-ink placeholder:text-faint focus:outline-none focus:border-accent/50"
            />
          ) : (
            <input
              value={customData}
              onChange={(e) => setCustomData(e.target.value)}
              placeholder="Raw calldata (0x...)"
              className="bg-white border border-line rounded-lg px-2.5 py-1.5 font-mono text-xs text-ink placeholder:text-faint focus:outline-none focus:border-accent/50"
            />
          )}
        </div>

        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={status === 'loading'}
            className="inline-flex items-center gap-1.5 font-mono text-[11px] text-accent border border-accent/40 rounded-full px-3 py-1.5 hover:bg-accentSoft transition-colors disabled:opacity-50"
          >
            {status === 'loading' ? (
              <>
                <Loader2 className="w-3 h-3 animate-spin" /> VALIDATING…
              </>
            ) : (
              'RUN CHECK'
            )}
          </button>
          {error && <span className="font-mono text-[11px] text-critical">{error}</span>}
        </div>
      </form>

      {result && (
        <div className="px-4 pb-4">
          <div className="border-t border-line pt-3 font-mono text-[11px] text-dim space-y-1.5">
            <div className="text-sm"><ResultBadge recommendation={result.recommendation} /></div>
            <p className="text-ink font-sans normal-case text-[13px] leading-snug">{result.summary}</p>
            <p>RISK &nbsp; {result.risk}</p>
            {result.matchedRules?.length > 0 && <p>RULES &nbsp; {result.matchedRules.join(', ')}</p>}
            {typeof result.confidence === 'number' && (
              <p>CONFIDENCE &nbsp; {Math.round(result.confidence * 100)}%</p>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
