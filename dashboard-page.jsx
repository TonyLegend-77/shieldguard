'use client';

import { Shield, Github } from 'lucide-react';
import { useWallet } from '../lib/wallet';
import { useTheme } from '../lib/theme';
import { useLanguage } from '../lib/i18n';
import WalletBar from '../components/WalletBar';
import ThemeToggle from '../components/ThemeToggle';
import LanguageToggle from '../components/LanguageToggle';
import MyContracts from '../components/MyContracts';
import ConnectionsPanel from '../components/ConnectionsPanel';
import SdkTester from '../components/SdkTester';
import CodeViewer from '../components/CodeViewer';

const FLOW_STEPS = [
  {
    n: '01 / INTERCEPT',
    title: 'JSON-RPC / SDK Hook',
    body: 'Agent constructs a UserOperation. Before it reaches the bundler, the payload is sent to the ShieldGuard oracle.',
  },
  {
    n: '02 / EVALUATE',
    title: 'Hard floor + forked-state simulation',
    body: 'Deterministic rules run first (see policy/rules). Then, where the RPC supports it, a forked-state simulation checks storage mutations and balance deltas.',
  },
  {
    n: '03 / ENFORCE',
    title: 'ERC-7579 co-sign',
    body: 'If compliant, the oracle returns an ECDSA co-signature. The validator contract rejects any UserOperation missing a valid one — once that contract is deployed. It isn\u2019t yet, see the code tab below.',
  },
];

export default function Dashboard() {
  const wallet = useWallet();
  const { theme, toggle } = useTheme();
  const { lang, setLang, t } = useLanguage();

  return (
    <div className="min-h-screen bg-paper text-ink">
      <nav className="border-b border-line sticky top-0 bg-paper/90 backdrop-blur z-40">
        <div className="max-w-6xl mx-auto px-5 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Shield className="w-4.5 h-4.5 text-accent" />
            <span className="font-display text-base text-ink">ShieldGuard</span>
          </div>
          <div className="hidden md:flex items-center gap-5 font-mono text-[11px] text-dim">
            <a href="/threats" className="hover:text-ink transition-colors">Threats</a>
            <a href="/pricing" className="hover:text-ink transition-colors">Pricing</a>
            <a href="#architecture" className="hover:text-ink transition-colors">Architecture</a>
            <a href="#integration" className="hover:text-ink transition-colors">Integration</a>
            <a href="https://github.com/TonyLegend-77/shieldguard" target="_blank" rel="noreferrer" className="hover:text-ink transition-colors inline-flex items-center gap-1">
              <Github className="w-3.5 h-3.5" /> Source
            </a>
          </div>
          <div className="flex items-center gap-2">
            <LanguageToggle lang={lang} onChange={setLang} />
            <ThemeToggle theme={theme} onToggle={toggle} />
            <WalletBar wallet={wallet} />
          </div>
        </div>
      </nav>

      <section className="max-w-6xl mx-auto px-5 pt-12 pb-10">
        <span className="inline-flex items-center gap-1.5 bg-accentSoft text-accent text-xs font-medium rounded-full px-3 py-1 mb-5">
          <span className="w-1.5 h-1.5 rounded-full bg-nominal animate-pulse" />
          {t('hero.badge')}
        </span>
      </section>

      <section className="max-w-6xl mx-auto px-5 py-10">
        {wallet.address ? (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            <MyContracts wallet={wallet} />
            <ConnectionsPanel wallet={wallet} />
          </div>
        ) : (
          <div className="border border-line rounded-xl bg-surfaceAlt p-6 text-center">
            <p className="text-sm text-body">{t('dash.connect.prompt')}</p>
          </div>
        )}
      </section>

      <section className="max-w-6xl mx-auto px-5 pb-10">
        <SdkTester wallet={wallet} />
      </section>

      <section id="architecture" className="border-t border-line py-16">
        <div className="max-w-6xl mx-auto px-5">
          <div className="max-w-2xl mb-10">
            <p className="text-xs font-medium tracking-wide text-dim uppercase mb-2">System architecture</p>
            <h2 className="font-display text-2xl text-ink mb-2">{t('dash.flow.title')}</h2>
            <p className="text-sm text-body leading-relaxed">
              Validation lives in a co-signing oracle paired with an on-chain smart-account module, not a
              client-side SDK an agent could just not call.
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            {FLOW_STEPS.map((s) => (
              <div key={s.n} className="p-4 rounded-lg border border-line bg-surface space-y-2">
                <div className="font-mono text-[11px] text-dim font-semibold">{s.n}</div>
                <div className="text-sm font-medium text-ink">{s.title}</div>
                <p className="text-xs text-body leading-relaxed">{s.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="integration" className="border-t border-line py-16">
        <div className="max-w-6xl mx-auto px-5">
          <div className="max-w-xl mb-6">
            <p className="text-xs font-medium tracking-wide text-dim uppercase mb-2">Integration</p>
            <h2 className="font-display text-2xl text-ink">Smart contract & SDK code</h2>
          </div>
          <CodeViewer />
        </div>
      </section>

      <footer className="border-t border-line py-8">
        <div className="max-w-6xl mx-auto px-5 text-xs text-faint font-mono">
          rule engine v2 \u00b7 policy engine v1 \u00b7 validator contract not yet deployed
        </div>
      </footer>
    </div>
  );
}
