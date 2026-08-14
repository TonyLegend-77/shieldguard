'use client';

import { useCallback, useEffect, useState } from 'react';

const KEY = 'sg_lang';

// Covers nav, hero, and section-header copy on the landing page and the
// dashboard. Form fields and results inside MyContracts, ConnectionsPanel,
// and SdkTester are NOT translated yet — those are a lot of strings across
// three files and weren't in scope for this pass. Ask if you want that
// covered too.
export const DICT = {
  en: {
    'nav.dashboard': 'Open the dashboard',
    'nav.source': 'View the source',
    'nav.workbench': 'Workbench',

    'hero.badge': 'Live on BOT Chain Mainnet',
    'hero.title1': 'Programmable firewall',
    'hero.title2': 'for autonomous AI transactions on BOT Chain.',
    'hero.body':
      'ShieldGuard is a non-custodial validation layer for BOT Chain. It intercepts risky approvals, ownership transfers, and agent transactions \u2014 runs hard-floor rules + simulation + AI advisory \u2014 then signs and anchors the proof on-chain.',

    'problem.label': 'The problem',
    'problem.title': 'One signature is all it takes.',
    'problem.body':
      'An unlimited approve() or a blanket setApprovalForAll() hands a stranger standing permission to drain a wallet, any time, without warning. AI agents make it worse: one prompt injection or hallucinated action, and a key with no supervision can move everything. Most tools only tell you after it\u2019s already gone.',

    'how.label': 'How it watches',
    'how.title': 'Three ways to catch a threat, one way to prove it.',
    'how.onchain.title': 'On-chain, live',
    'how.onchain.body':
      'Polls Approval, Transfer, ApprovalForAll, OwnershipTransferred, and Paused events every few seconds, plus raw calldata for contracts with no standard event to watch.',
    'how.presign.title': 'Pre-signing, for agents',
    'how.presign.body':
      'A non-custodial SDK checks a transaction against the same rule engine before an AI agent ever signs it. ShieldGuard never holds the key, only returns a verdict.',
    'how.signed.title': 'Signed and anchored',
    'how.signed.body':
      'Every flagged result gets an AI verdict, a cryptographic signature, and a permanent on-chain receipt, so a threat can\u2019t be quietly edited or disputed later.',

    'debugger.label': 'Policy engine debugger',
    'debugger.title': 'Watch the pipeline decide.',
    'debugger.body':
      'This calls your real /api/oracle/evaluate endpoint. Same hard-floor rules and AI advisory a real transaction gets, no scripted outcome.',

    'dash.hero.title': 'Programmable firewall for autonomous AI transactions.',
    'dash.hero.body':
      'ShieldGuard enforces pre-execution state checks and dual-key ECDSA co-signatures on ERC-7579 smart accounts before a UserOperation ever reaches the mempool.',
    'dash.contracts.title': 'My contracts',
    'dash.connections.title': 'Connected wallets & agents',
    'dash.sdk.title': 'SDK & Intent Router tester',
    'dash.flow.title': 'Dual-key validation flow',
    'dash.connect.prompt': 'Connect a wallet to manage contracts and connections.',
  },
  zh: {
    'nav.dashboard': '打开控制台',
    'nav.source': '查看源代码',
    'nav.workbench': '工作台',

    'hero.badge': 'BOT Chain 主网已上线',
    'hero.title1': '可编程防火墙',
    'hero.title2': '为 BOT Chain 上的自主 AI 交易保驾护航。',
    'hero.body':
      'ShieldGuard 是 BOT Chain 的非托管验证层。它拦截高风险的授权、所有权转移和代理交易——运行强制规则 + 模拟执行 + AI 顾问审查——然后签署裁决并将证明记录上链。',

    'problem.label': '问题所在',
    'problem.title': '一次签名，足以清空钱包。',
    'problem.body':
      '一次无限额度的 approve() 或一次性的 setApprovalForAll()，就等于把随时清空钱包的权限交给了陌生人。AI 代理让情况更糟：一次提示注入或幻觉动作，一把无人监督的密钥就能转走一切。大多数工具只能在资产已经转走之后才告诉你。',

    'how.label': '监控方式',
    'how.title': '三种发现威胁的方式，一种证明的方式。',
    'how.onchain.title': '链上实时监控',
    'how.onchain.body':
      '每隔几秒轮询 Approval、Transfer、ApprovalForAll、OwnershipTransferred 和 Paused 事件，对没有标准事件可监控的合约则直接读取原始调用数据。',
    'how.presign.title': '代理签名前拦截',
    'how.presign.body':
      '非托管 SDK 会在 AI 代理签名之前，用同一套规则引擎检查交易。ShieldGuard 从不持有密钥，只返回一个裁决结果。',
    'how.signed.title': '签署并上链存证',
    'how.signed.body':
      '每一次被标记的结果都会附带 AI 裁决、加密签名和永久的链上凭证，威胁记录无法被悄悄修改或事后否认。',

    'debugger.label': '策略引擎调试器',
    'debugger.title': '实时查看判定过程。',
    'debugger.body':
      '这里调用的是你真实的 /api/oracle/evaluate 接口。使用与真实交易相同的强制规则和 AI 建议，结果并非预先写好的脚本。',

    'dash.hero.title': '面向自主 AI 交易的可编程防火墙。',
    'dash.hero.body':
      'ShieldGuard 在 UserOperation 进入内存池之前，对 ERC-7579 智能账户执行预执行状态检查和双密钥 ECDSA 联合签名。',
    'dash.contracts.title': '我的合约',
    'dash.connections.title': '已连接的钱包与代理',
    'dash.sdk.title': 'SDK 与意图路由测试器',
    'dash.flow.title': '双密钥验证流程',
    'dash.connect.prompt': '连接钱包以管理合约和连接。',
  },
};

export function useLanguage() {
  const [lang, setLangState] = useState('en');

  useEffect(() => {
    try {
      const stored = localStorage.getItem(KEY);
      if (stored && DICT[stored]) setLangState(stored);
    } catch {}
  }, []);

  const setLang = useCallback((next) => {
    setLangState(next);
    try {
      localStorage.setItem(KEY, next);
    } catch {}
  }, []);

  const t = useCallback((key) => (DICT[lang] && DICT[lang][key]) || DICT.en[key] || key, [lang]);

  return { lang, setLang, t };
}
