'use client';

import { Wallet, AlertTriangle } from 'lucide-react';

function short(addr) {
  if (!addr) return '—';
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export default function WalletBar({ wallet }) {
  const { address, connecting, hasProvider, connect, disconnect, wrongChain, switchToTargetChain, targetChainId } = wallet;

  if (!address) {
    return (
      <button
        onClick={connect}
        disabled={connecting}
        className="inline-flex items-center gap-2 font-mono text-[11px] tracking-wide border border-line rounded-full px-3 py-1.5 text-dim hover:text-ink hover:border-accent/40 transition-colors disabled:opacity-50"
      >
        <Wallet className="w-3.5 h-3.5" />
        {connecting ? 'CONNECTING…' : hasProvider ? 'CONNECT WALLET' : 'GET METAMASK'}
      </button>
    );
  }

  if (wrongChain) {
    return (
      <button
        onClick={switchToTargetChain}
        className="inline-flex items-center gap-2 font-mono text-[11px] tracking-wide border border-caution/40 rounded-full px-3 py-1.5 text-caution hover:bg-caution/10 transition-colors"
      >
        <AlertTriangle className="w-3.5 h-3.5" />
        WRONG NETWORK — SWITCH TO {targetChainId}
      </button>
    );
  }

  return (
    <button
      onClick={disconnect}
      className="group inline-flex items-center gap-2 font-mono text-[11px] tracking-wide border border-line rounded-full px-3 py-1.5 text-ink hover:border-critical/40 transition-colors"
      title="Click to disconnect"
    >
      <span className="w-1.5 h-1.5 rounded-full bg-nominal" />
      <span className="group-hover:hidden">{short(address)}</span>
      <span className="hidden group-hover:inline text-critical">DISCONNECT</span>
    </button>
  );
}
