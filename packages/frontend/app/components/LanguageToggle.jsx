'use client';

export default function LanguageToggle({ lang, onChange }) {
  return (
    <button
      onClick={() => onChange(lang === 'en' ? 'zh' : 'en')}
      aria-label="Toggle English/Chinese"
      title="English / \u4e2d\u6587"
      className="inline-flex items-center justify-center h-8 px-2.5 rounded-full border border-line text-dim hover:text-ink hover:border-accent/40 transition-colors font-mono text-[11px]"
    >
      {lang === 'en' ? 'EN' : '\u4e2d\u6587'}
    </button>
  );
}
