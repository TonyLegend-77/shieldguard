'use client';

import { useState } from 'react';
import { FlaskConical, Loader2, ShieldCheck, ShieldAlert, ShieldX } from 'lucide-react';
import { encodeApprove, encodeApprovalForAll, encodeTransfer, MAX_UINT256 } from '../lib/calldata';
import { sendRawTransaction } from '../lib/wallet';

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

const INTENT_ACTIONS = {
  approve: {
    label: 'approve()',
    fields: ['spender', 'amount'],
  },
  setApprovalForAll: {
    label: 'setApprovalForAll()',
    fields: ['operator', 'approved'],
  },
  transfer: {
    label: 'transfer()',
    fields: ['to', 'amount'],
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
  const [mode, setMode] = useState('calldata'); // 'calldata' (SDK Wrapper) | 'intent' (Intent Router)

  // --- Calldata mode state (SDK Wrapper / /api/validate) ------------------
  const [scenario, setScenario] = useState('unlimited_approve');
  const [from, setFrom] = useState(wallet?.address || '');
  const [to, setTo] = useState('');
  const [spender, setSpender] = useState('');
  const [customData, setCustomData] = useState('0x');

  // --- Intent mode state (Intent Router / /api/intent/build) --------------
  const [intentAction, setIntentAction] = useState('approve');
  const [intentFrom, setIntentFrom] = useState(wallet?.address || '');
  const [intentToken, setIntentToken] = useState('');
  const [intentSpender, setIntentSpender] = useState('');
  const [intentOperator, setIntentOperator] = useState('');
  const [intentTo, setIntentTo] = useState('');
  const [intentAmount, setIntentAmount] = useState(MAX_UINT256.toString());
  const [intentApproved, setIntentApproved] = useState(true);

  const [status, setStatus] = useState(null); // null | 'loading' | 'error'
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  // Sign & send state — separate from the build/validate status above,
  // since building/validating and broadcasting the resulting tx are two
  // distinct steps the user can fail/retry independently. builtTx holds the
  // { to, data, value } used for the Calldata-mode check — /api/validate
  // doesn't hand a tx back (it's read-only), so we keep our own copy of
  // what was actually checked, to send exactly that if it wasn't blocked.
  const [sendStatus, setSendStatus] = useState(null); // null | 'sending' | 'sent' | 'error'
  const [sendError, setSendError] = useState(null);
  const [sentTxHash, setSentTxHash] = useState(null);
  const [builtTx, setBuiltTx] = useState(null);

  const cfg = SCENARIOS[scenario];
  const intentCfg = INTENT_ACTIONS[intentAction];

  const switchMode = (next) => {
    setMode(next);
    setResult(null);
    setError(null);
    setSendStatus(null);
    setSendError(null);
    setSentTxHash(null);
    setBuiltTx(null);
  };

  const runCalldata = async (e) => {
    e.preventDefault();
    setError(null);
    setResult(null);
    setSendStatus(null);
    setSendError(null);
    setSentTxHash(null);
    setBuiltTx(null);

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
      // Keep exactly what was checked so SIGN & SEND sends the same tx the
      // verdict above was actually computed against — not a re-derivation.
      setBuiltTx({ to, data, value: '0' });
      setStatus(null);
    } catch (err) {
      setError(err.message);
      setStatus(null);
    }
  };

  // Mirrors @shieldguard/sdk's buildIntent() — same plain-fields shape,
  // hitting the same /api/intent/build endpoint the SDK talks to. This lets
  // you see exactly what an agent using buildIntent() would get back,
  // including the ready-to-sign tx object when approved.
  const runIntent = async (e) => {
    e.preventDefault();
    setError(null);
    setResult(null);
    setSendStatus(null);
    setSendError(null);
    setSentTxHash(null);
    setBuiltTx(null);

    const fromAddr = intentFrom || wallet?.address;
    if (!fromAddr || !ADDR_RE.test(fromAddr)) return setError('Enter a valid "from" address.');
    if (!intentToken || !ADDR_RE.test(intentToken)) return setError('Enter a valid token/contract address.');

    const payload = { action: intentAction, from: fromAddr, token: intentToken };

    if (intentAction === 'approve') {
      if (!intentSpender || !ADDR_RE.test(intentSpender)) return setError('Enter a valid spender address.');
      if (!intentAmount) return setError('Enter an amount.');
      payload.spender = intentSpender;
      payload.amount = intentAmount;
    } else if (intentAction === 'setApprovalForAll') {
      if (!intentOperator || !ADDR_RE.test(intentOperator)) return setError('Enter a valid operator address.');
      payload.operator = intentOperator;
      payload.approved = intentApproved;
    } else if (intentAction === 'transfer') {
      if (!intentTo || !ADDR_RE.test(intentTo)) return setError('Enter a valid recipient address.');
      if (!intentAmount) return setError('Enter an amount.');
      payload.to = intentTo;
      payload.amount = intentAmount;
    }

    setStatus('loading');
    try {
      const res = await fetch(`${API}/api/intent/build`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Intent build failed');
      setResult({
        recommendation: json.recommendation,
        summary: json.summary,
        risk: json.risk,
        matchedRules: json.matchedRules,
        confidence: json.confidence,
        tx: json.tx,
        approved: json.approved,
      });
      setStatus(null);
    } catch (err) {
      setError(err.message);
      setStatus(null);
    }
  };

  const run = mode === 'intent' ? runIntent : runCalldata;

  // What's actually offered for signing depends on mode: Intent mode gets
  // the tx straight from /api/intent/build (already null if blocked).
  // Calldata mode never gets a tx back from /api/validate (read-only check),
  // so we offer the exact builtTx that was checked — but only if it wasn't
  // recommended for blocking, so this demo tool doesn't casually offer to
  // broadcast something the rule engine just flagged as REVOKE_IMMEDIATELY.
  const txToSend =
    mode === 'intent' ? result?.tx : result && result.recommendation !== 'REVOKE_IMMEDIATELY' ? builtTx : null;
  const sendFromAddr = mode === 'intent' ? intentFrom || wallet?.address : from || wallet?.address;

  const sendTx = async () => {
    setSendError(null);
    setSendStatus('sending');
    try {
      const hash = await sendRawTransaction({ from: sendFromAddr, ...txToSend });
      setSentTxHash(hash);
      setSendStatus('sent');
    } catch (err) {
      setSendError(err.message);
      setSendStatus('error');
    }
  };

  return (
    <section className="border border-line bg-surface rounded-xl overflow-hidden animate-fadeUp">
      <div className="border-b border-line px-4 py-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <FlaskConical className="w-3.5 h-3.5 text-dim" />
          <h2 className="font-display text-sm text-ink">
            SDK pre-signing tester — {mode === 'intent' ? '/api/intent/build' : '/api/validate'}
          </h2>
        </div>

        <div className="flex items-center gap-1 bg-white border border-line rounded-full p-0.5">
          <button
            type="button"
            onClick={() => switchMode('calldata')}
            className={`font-mono text-[10px] rounded-full px-2.5 py-1 transition-colors ${
              mode === 'calldata' ? 'bg-accent text-white' : 'text-dim hover:text-ink'
            }`}
          >
            CALLDATA
          </button>
          <button
            type="button"
            onClick={() => switchMode('intent')}
            className={`font-mono text-[10px] rounded-full px-2.5 py-1 transition-colors ${
              mode === 'intent' ? 'bg-accent text-white' : 'text-dim hover:text-ink'
            }`}
          >
            INTENT
          </button>
        </div>
      </div>

      {mode === 'calldata' ? (
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
      ) : (
        <form onSubmit={run} className="px-4 py-4 space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <select
              value={intentAction}
              onChange={(e) => setIntentAction(e.target.value)}
              className="bg-white border border-line rounded-lg px-2.5 py-1.5 font-mono text-xs text-ink focus:outline-none focus:border-accent/50"
            >
              {Object.entries(INTENT_ACTIONS).map(([key, a]) => (
                <option key={key} value={key}>{a.label}</option>
              ))}
            </select>

            <input
              value={intentFrom}
              onChange={(e) => setIntentFrom(e.target.value)}
              placeholder="From address (defaults to connected wallet)"
              className="bg-white border border-line rounded-lg px-2.5 py-1.5 font-mono text-xs text-ink placeholder:text-faint focus:outline-none focus:border-accent/50"
            />

            <input
              value={intentToken}
              onChange={(e) => setIntentToken(e.target.value)}
              placeholder="Token / contract address"
              className="bg-white border border-line rounded-lg px-2.5 py-1.5 font-mono text-xs text-ink placeholder:text-faint focus:outline-none focus:border-accent/50"
            />

            {intentCfg.fields.includes('spender') && (
              <input
                value={intentSpender}
                onChange={(e) => setIntentSpender(e.target.value)}
                placeholder="Spender address"
                className="bg-white border border-line rounded-lg px-2.5 py-1.5 font-mono text-xs text-ink placeholder:text-faint focus:outline-none focus:border-accent/50"
              />
            )}

            {intentCfg.fields.includes('operator') && (
              <input
                value={intentOperator}
                onChange={(e) => setIntentOperator(e.target.value)}
                placeholder="Operator address"
                className="bg-white border border-line rounded-lg px-2.5 py-1.5 font-mono text-xs text-ink placeholder:text-faint focus:outline-none focus:border-accent/50"
              />
            )}

            {intentCfg.fields.includes('to') && (
              <input
                value={intentTo}
                onChange={(e) => setIntentTo(e.target.value)}
                placeholder="Recipient address"
                className="bg-white border border-line rounded-lg px-2.5 py-1.5 font-mono text-xs text-ink placeholder:text-faint focus:outline-none focus:border-accent/50"
              />
            )}

            {intentCfg.fields.includes('amount') && (
              <input
                value={intentAmount}
                onChange={(e) => setIntentAmount(e.target.value)}
                placeholder="Amount (wei, e.g. max uint256 for unlimited)"
                className="bg-white border border-line rounded-lg px-2.5 py-1.5 font-mono text-xs text-ink placeholder:text-faint focus:outline-none focus:border-accent/50"
              />
            )}

            {intentCfg.fields.includes('approved') && (
              <label className="flex items-center gap-2 font-mono text-xs text-ink px-2.5 py-1.5">
                <input
                  type="checkbox"
                  checked={intentApproved}
                  onChange={(e) => setIntentApproved(e.target.checked)}
                  className="accent-current"
                />
                approved
              </label>
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
                  <Loader2 className="w-3 h-3 animate-spin" /> BUILDING INTENT…
                </>
              ) : (
                'BUILD INTENT'
              )}
            </button>
            {error && <span className="font-mono text-[11px] text-critical">{error}</span>}
          </div>
        </form>
      )}

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
            {txToSend && (
              <div className="pt-1.5 space-y-1.5">
                <p className="text-ink">{mode === 'intent' ? 'READY-TO-SIGN TX' : 'CHECKED TX'}</p>
                <p>TO &nbsp;&nbsp; {txToSend.to}</p>
                <p>DATA &nbsp; {txToSend.data}</p>
                <p>VALUE {txToSend.value}</p>

                <div className="pt-1 flex items-center gap-3">
                  {wallet?.address ? (
                    <button
                      type="button"
                      onClick={sendTx}
                      disabled={sendStatus === 'sending' || sendStatus === 'sent'}
                      className="inline-flex items-center gap-1.5 font-mono text-[11px] text-nominal border border-nominal/40 rounded-full px-3 py-1.5 hover:bg-nominal/10 transition-colors disabled:opacity-50"
                    >
                      {sendStatus === 'sending' ? (
                        <>
                          <Loader2 className="w-3 h-3 animate-spin" /> SENDING…
                        </>
                      ) : sendStatus === 'sent' ? (
                        'SENT ✓'
                      ) : (
                        'SIGN & SEND'
                      )}
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={wallet?.connect}
                      disabled={wallet?.connecting}
                      className="inline-flex items-center gap-1.5 font-mono text-[11px] text-accent border border-accent/40 rounded-full px-3 py-1.5 hover:bg-accentSoft transition-colors disabled:opacity-50"
                    >
                      {wallet?.connecting ? (
                        <>
                          <Loader2 className="w-3 h-3 animate-spin" /> CONNECTING…
                        </>
                      ) : (
                        'CONNECT WALLET TO SIGN'
                      )}
                    </button>
                  )}
                  {sendError && <span className="text-critical">{sendError}</span>}
                </div>

                {sentTxHash && (
                  <p className="text-ink break-all">
                    TX HASH &nbsp;
                    <a
                      href={`${process.env.NEXT_PUBLIC_EXPLORER_URL || 'https://scan.bohr.life'}/tx/${sentTxHash}`}
                      target="_blank"
                      rel="noreferrer"
                      className="text-accent underline"
                    >
                      {sentTxHash}
                    </a>
                  </p>
                )}
              </div>
            )}
            {mode === 'intent' && result.approved === false && (
              <p className="text-critical">No tx returned — blocked, nothing to sign.</p>
            )}
            {mode === 'calldata' && result.recommendation === 'REVOKE_IMMEDIATELY' && (
              <p className="text-critical">Blocked by the rule engine — not offering to sign this one.</p>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
