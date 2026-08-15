'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Shield, Eye, FileSignature, KeyRound, ArrowRight } from 'lucide-react';
import PolicyDebugger from './components/PolicyDebugger';
import ThreatFeed from './components/ThreatFeed';
import ThemeToggle from './components/ThemeToggle';
import LanguageToggle from './components/LanguageToggle';
import { useTheme } from './lib/theme';
import { useLanguage } from './lib/i18n';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

export default function LandingPage() {
  const [stats, setStats] = useState(null);
  const { theme, toggle } = useTheme();
  const { lang, setLang, t } = useLanguage();

  useEffect(() => {
    fetch(`${API}/api/stats/global`)
      .then((r) => r.json())
      .then(setStats)
      .catch(() => {});
  }, []);

  return (
    <main className="min-h-screen bg-paper">
      <div className="max-w-5xl mx-auto px-5">

        <nav className="flex items-center justify-between py-6">
          <div className="flex items-center gap-2">
            <Shield className="w-5 h-5 text-accent" strokeWidth={1.75} />
            <span className="font-display text-lg font-medium text-ink">ShieldGuard</span>
          </div>
          <div className="flex items-center gap-3">
            <Link href="/threats" className="hidden md:inline text-sm font-medium text-dim hover:text-ink transition-colors">
              Threats
            </Link>
            <Link href="/pricing" className="hidden md:inline text-sm font-medium text-dim hover:text-ink transition-colors">
              Pricing
            </Link>
            <LanguageToggle lang={lang} onChange={setLang} />
            <ThemeToggle theme={theme} onToggle={toggle} />
            <Link
              href="/dashboard"
              className="inline-flex items-center gap-1.5 bg-accent text-white text-sm font-medium rounded-full px-4 py-2 hover:bg-accent/90 transition-colors"
            >
              {t('nav.dashboard')}
            </Link>
          </div>
        </nav>

        {/* Hero */}
        <section className="pt-10 pb-16 text-center animate-fadeUp">
          <span className="inline-flex items-center gap-1.5 bg-accentSoft text-accent text-xs font-medium rounded-full px-3 py-1 mb-6">
            <span className="w-1.5 h-1.5 rounded-full bg-nominal" />
            {t('hero.badge')}
          </span>

          <h1 className="font-display text-4xl md:text-6xl leading-[1.1] text-ink mb-5">
            {t('hero.title1')}<br />{t('hero.title2')}
          </h1>

          <p className="max-w-xl mx-auto text-body text-base md:text-lg leading-relaxed mb-8">
            {t('hero.body')}
          </p>

          <div className="flex items-center justify-center gap-5">
            <Link
              href="/dashboard"
              className="inline-flex items-center gap-1.5 bg-accent text-white text-sm font-medium rounded-full px-5 py-2.5 hover:bg-accent/90 transition-colors"
            >
              {t('nav.dashboard')}
              <ArrowRight className="w-3.5 h-3.5" />
            </Link>
            <a
              href="https://github.com/TonyLegend-77/shieldguard"
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm font-medium text-ink hover:text-accent transition-colors"
            >
              {t('nav.source')} →
            </a>
          </div>
        </section>
      </div>

      {/* The problem */}
      <section className="bg-surfaceAlt py-16">
        <div className="max-w-5xl mx-auto px-5 grid grid-cols-1 md:grid-cols-[1fr_1.2fr] gap-8">
          <div>
            <p className="text-xs font-medium tracking-wide text-dim uppercase mb-2">{t('problem.label')}</p>
            <h2 className="font-display text-2xl md:text-3xl text-ink leading-snug">
              {t('problem.title')}
            </h2>
          </div>
          <p className="text-body leading-relaxed">
            {lang === 'en' ? (
              <>
                An unlimited <code className="font-mono text-sm bg-surface border border-line rounded px-1.5 py-0.5">approve()</code>{' '}
                or a blanket <code className="font-mono text-sm bg-surface border border-line rounded px-1.5 py-0.5">setApprovalForAll()</code>{' '}
                hands a stranger standing permission to drain a wallet — any time, without
                warning. AI agents make it worse: one prompt injection or hallucinated
                action, and a key with no supervision can move everything. Most tools
                only tell you after it's already gone.
              </>
            ) : (
              t('problem.body')
            )}
          </p>
        </div>
      </section>

      {/* How it watches */}
      <section className="py-16">
        <div className="max-w-5xl mx-auto px-5">
          <p className="text-xs font-medium tracking-wide text-dim uppercase mb-2 text-center">{t('how.label')}</p>
          <h2 className="font-display text-2xl md:text-3xl text-ink text-center mb-10">
            {t('how.title')}
          </h2>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            <FeatureCard
              icon={<Eye className="w-5 h-5" />}
              title={t('how.onchain.title')}
              body={t('how.onchain.body')}
            />
            <FeatureCard
              icon={<KeyRound className="w-5 h-5" />}
              title={t('how.presign.title')}
              body={t('how.presign.body')}
            />
            <FeatureCard
              icon={<FileSignature className="w-5 h-5" />}
              title={t('how.signed.title')}
              body={t('how.signed.body')}
            />
          </div>
        </div>
      </section>

      <PolicyDebugger t={t} />

      {/* Live proof */}
      <section className="bg-surfaceAlt py-12">
        <div className="max-w-5xl mx-auto px-5 flex flex-wrap items-center justify-center gap-x-12 gap-y-4 text-center">
          <LiveStat label="Contracts watched" value={stats?.totalContracts} />
          <LiveStat label="Transactions scanned" value={stats?.totalScanned} />
          <LiveStat label="Threats flagged" value={stats?.totalFlagged} />
          <LiveStat label="Active right now" value={stats?.activeContracts} />
        </div>
      </section>

      {/* Live feed teaser — real data by default. Simulated mode is clearly
          labeled and never mixed with real entries. Full feed logic lives
          in ThreatFeed.jsx, shared with the dedicated /threats page. */}
      <section className="py-16">
        <div className="max-w-3xl mx-auto px-5">
          <ThreatFeed compact />
          <p className="text-center mt-4">
            <Link href="/threats" className="font-mono text-[11px] text-accent hover:underline">
              Open the full threat feed →
            </Link>
          </p>
        </div>
      </section>

      <footer className="py-10 text-center">
        <Link
          href="/dashboard"
          className="inline-flex items-center gap-1.5 bg-accent text-white text-sm font-medium rounded-full px-5 py-2.5 hover:bg-accent/90 transition-colors"
        >
          Open the dashboard
          <ArrowRight className="w-3.5 h-3.5" />
        </Link>
        <p className="mt-6 text-xs text-faint">46 threat patterns · rule engine v2 · policy engine v1</p>
      </footer>
    </main>
  );
}

function FeatureCard({ icon, title, body }) {
  return (
    <div className="bg-surface border border-line rounded-xl p-6">
      <div className="w-9 h-9 rounded-full bg-accentSoft text-accent flex items-center justify-center mb-4">
        {icon}
      </div>
      <h3 className="font-display text-lg text-ink mb-2">{title}</h3>
      <p className="text-sm text-body leading-relaxed">{body}</p>
    </div>
  );
}

function LiveStat({ label, value }) {
  return (
    <div>
      <p className="font-display text-3xl text-ink">{value ?? '—'}</p>
      <p className="text-xs text-dim mt-1">{label}</p>
    </div>
  );
}
