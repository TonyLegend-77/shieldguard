'use client';

import { Sun, Moon } from 'lucide-react';

export default function ThemeToggle({ theme, onToggle }) {
  return (
    <button
      onClick={onToggle}
      aria-label="Toggle light/dark theme"
      title="Toggle light/dark theme"
      className="inline-flex items-center justify-center w-8 h-8 rounded-full border border-line text-dim hover:text-ink hover:border-accent/40 transition-colors"
    >
      {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
    </button>
  );
}
