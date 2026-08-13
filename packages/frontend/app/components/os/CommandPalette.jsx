'use client';

import { useEffect, useRef, useState } from 'react';
import { Terminal } from 'lucide-react';

const SUGGESTIONS = [
  'Enforce maximum 2.5% slippage on Uniswap V3 routes across all sub-agents',
  'Block ERC20 approvals over 500 USDC to contracts deployed less than 7 days ago',
  'Require multisig approval for any EIP-1967 proxy upgrade',
];

export default function CommandPalette({ open, onClose, onCompile }) {
  const [value, setValue] = useState('');
  const inputRef = useRef(null);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  useEffect(() => {
    function handleKey(e) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [onClose]);

  if (!open) return null;

  function submit(text) {
    const trimmed = text.trim();
    if (!trimmed) return;
    onCompile(trimmed);
    setValue('');
  }

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-50 flex items-start justify-center pt-20" onClick={onClose}>
      <div
        className="bg-zinc-900 border border-zinc-800 rounded-lg w-full max-w-2xl mx-4 shadow-2xl overflow-hidden font-mono text-xs"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-3 border-b border-zinc-800 flex items-center justify-between">
          <div className="flex items-center space-x-2 text-zinc-400 w-full">
            <Terminal className="w-3.5 h-3.5 text-zinc-500 flex-shrink-0" />
            <input
              ref={inputRef}
              type="text"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && submit(value)}
              placeholder="Describe a policy rule in plain English..."
              className="bg-transparent border-none outline-none text-zinc-100 placeholder-zinc-600 w-full pr-4 text-xs font-mono"
            />
          </div>
          <kbd className="px-1.5 py-0.5 bg-zinc-950 border border-zinc-800 rounded text-[10px] text-zinc-500">ESC</kbd>
        </div>

        <div className="p-3 bg-zinc-950/80 space-y-2">
          <div className="text-[10px] text-zinc-500 uppercase tracking-wider">Suggested directives</div>
          {SUGGESTIONS.map((s) => (
            <div
              key={s}
              onClick={() => submit(s)}
              className="p-2 rounded bg-zinc-900/60 border border-zinc-800/80 hover:border-zinc-700 cursor-pointer flex justify-between items-center gap-3 text-zinc-300 hover:text-white"
            >
              <span>{s}</span>
              <span className="text-emerald-400 text-[10px] flex-shrink-0">↵ Compile</span>
            </div>
          ))}
        </div>

        <div className="p-2 border-t border-zinc-800/80 bg-zinc-950 text-[10px] text-zinc-500 flex justify-between">
          <span>Natural language rule compiler</span>
          <span>
            Press <strong className="text-zinc-300">Enter</strong> to compile
          </span>
        </div>
      </div>
    </div>
  );
}
