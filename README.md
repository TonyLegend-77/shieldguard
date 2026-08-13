# ShieldGuard — Agent Security & Transaction Validation Layer for BOT Chain

AI agents and wallets get drained because approvals are invisible until it's too late. ShieldGuard watches BOT Chain in real time and turns suspicious activity into proof before damage is done — **detection and proof, never custody.** ShieldGuard never holds a key, never holds funds, and never touches gas on anyone's behalf — it only watches, scores, verdicts, signs, and anchors.

That principle extends to agents too: `@shieldguard/sdk` lets an AI agent get every transaction checked *before* it signs, without ever handing ShieldGuard a private key. A cryptographically-enforced version of that same check — where the check can't be skipped or bypassed, not just advised — is designed and written (`ShieldGuardValidator7579.sol`) but **not yet deployed**; see [Cryptographic Enforcement Layer](#cryptographic-enforcement-layer-erc-7579--designed-not-deployed) below for exactly what that means.

## What it actually watches

**On-chain, event-based** (polled every ~4s, `packages/backend/src/listener.js`):
- `Approval` — unlimited approvals, approvals exceeding 10x the owner's balance
- `Transfer` — zero-value "address poisoning" transfers from lookalike addresses
- `ApprovalForAll` (ERC-721/1155) — blanket collection-wide approvals to unrecognized operators, the mechanism behind most NFT drainer kits
- `OwnershipTransferred`, `Paused`, `Unpaused` — admin/owner privileged-call monitoring, distinct from user-wallet risk

**On-chain, transaction-based** (`contractTargets.js`): for contracts with no standard event to watch, ShieldGuard pulls each full block and matches `tx.data`'s 4-byte selector against a per-contract map of real function selectors. Split by network:
- **Testnet** (chain 968): 11 hand-annotated contracts, selectors read directly off verified source on scan.bohr.life
- **Mainnet** (chain 677): 987 unique addresses deduped from BOT Chain's full verified+unverified contract dump (`mainnetContracts.json`). 488 have real function-selector maps pulled from actual ABIs; 367 of those are flagged with at least one critical function by a name-pattern heuristic (`transferOwnership`, `mint`, `approve`, `grantRole`, `upgradeTo`, `withdraw`, `pause`, etc.) — a starting point for review, not a manual per-contract audit. The remaining ~500 addresses are visibility-only (no ABI available). Which network's list is active is controlled by `CHAIN_ID`.

**Pre-signing, via HTTP** (`POST /api/validate`, `POST /api/intent/build`): the same rule engine runs against proposed calldata *before* a transaction is signed — decoding `approve`, `setApprovalForAll`, `transfer`/`transferFrom`, and any mapped critical-function call. This is what `@shieldguard/sdk` calls under the hood.

Every flagged result — regardless of which detector caught it — runs through one shared pipeline: AI verdict → cryptographic signature → on-chain anchor via `ReceiptRegistry.sol` → recorded to the dashboard → outbound alert (generic webhook + personal Telegram, see below).

## Architecture

```
┌─────────────────┐     ┌──────────────────┐     ┌──────────────────┐
│   Next.js        │────▶│  Express API     │────▶│  Event Listener  │
│ Landing+Dashboard │◄────│  (Railway)       │◄────│  (Ethers.js)     │
│   (Vercel)        │     │                  │     │                 │
└─────────────────┘     └──────────────────┘     └──────────────────┘
                              │      │                    │
                              ▼      ▼                    ▼
                      ┌─────────┐ ┌──────────┐    ┌──────────────────┐
                      │ Store    │ │ Webhook  │    │  Rule Engine      │
                      │(memory or│ │ /monitor │    │ (P/N/A/T/C rules) │
                      │ SQLite)  │ └──────────┘    └──────────────────┘
                      └─────────┘                          │
                              │                             ▼
                              ▼                     ┌──────────────────┐
                      ┌──────────────┐               │  AI Policy Engine │
                      │ Connections   │               │ (Gemini→OpenAI→   │
                      │ (wallet/agent │               │  Anthropic→local) │
                      │  watchlist +  │               └──────────────────┘
                      │  tiering)     │                        │
                      └──────┬───────┘                         ▼
                              │                        ┌──────────────────┐
                              ▼                        │ Signature Service │
                      ┌──────────────┐                 └──────────────────┘
                      │ Alert Dispatch│                         │
                      │ (HMAC webhook │                         ▼
                      │  + Telegram)  │                ┌──────────────────┐
                      └──────────────┘                 │ ReceiptRegistry   │
                                                        │   (Solidity)      │
                                                        └──────────────────┘

┌──────────────────┐
│ @shieldguard/sdk  │──── HTTP only, no shared code ────▶  POST /api/validate
│ (agents/wallets)  │──── HTTP only, no shared code ────▶  POST /api/intent/build
└──────────────────┘

┌─────────────────────────────────────────────────────────────────────────┐
│  DESIGNED, NOT DEPLOYED — cryptographic enforcement layer                │
│  Agent → ERC-4337 UserOp → ShieldGuardValidator7579.sol (on-chain)      │
│         requires BOTH agent signature AND oracle co-signature           │
│         (validationOracle.js: hard-floor rules → simulation → AI)       │
│  Blocked by: no confirmed EntryPoint/bundler on BOT Chain yet —         │
│  BOT Chain's own AI Agent Launchpad V1 announcement says ERC-4337       │
│  support is "coming soon," no date given.                               │
└─────────────────────────────────────────────────────────────────────────┘
```

## Frontend

`packages/frontend` is a two-route Next.js app:
- `/` — marketing landing page (hero, the problem, how it watches, a live stats strip pulled from `/api/stats/global`, and a live/simulated threat feed toggle — simulated mode animates a full agent-interception pipeline: Intercept → Classify → Hard Floor → Simulate → AI Advisory → Decision)
- `/dashboard` — the actual live console: Guardians, the flagged-activity feed (each entry rendered as a signed "receipt"), your connected wallet's contracts, personal wallet/agent connections + Telegram alert linking, and the SDK pre-signing tester

Light theme (paper/lavender), Fraunces for display type, IBM Plex Sans/Mono for body and data.

A standalone, dependency-free `shieldguard-landing.html` (repo root) mirrors the landing page's content and live/simulated demo without needing the Next.js build — useful for a quick local preview or embedding somewhere the full app isn't deployed. Edit the `API` constant near the top of its `<script>` block to point at a real backend before relying on the live-data side of it.

## Non-custodial agent firewall (`packages/sdk`)

AI agents holding their own keys are a major drain vector — a compromised or prompt-injected agent can sign anything it's tricked into. `@shieldguard/sdk` wraps any ethers.js signer and checks every transaction with ShieldGuard before it's signed:

```js
import { ShieldGuardSigner } from '@shieldguard/sdk';

const signer = new ShieldGuardSigner(agentWallet, { apiUrl: 'https://your-backend.up.railway.app' });
await signer.sendTransaction(tx); // throws if ShieldGuard flags it — never reaches the real signer
```

ShieldGuard never holds a key, never touches gas, and never signs anything on the agent's behalf — it only returns a verdict. Agents that would rather describe *what* they want than build calldata can use the Intent Router (`buildIntent`) instead, which validates a high-level action (`approve`, `setApprovalForAll`, `transfer`) and returns a ready-to-sign tx for the caller's own wallet.

**The limitation of this approach, and why the enforcement layer below exists:** this is advisory. The agent's own code decides whether to act on ShieldGuard's verdict — a bug, a compromised agent, or a prompt-injected agent (OWASP ranks this ASI01: Agent Goal Hijack as the top 2026 agentic risk) can simply not call it, or ignore what it says.

## Alerts & Personal Connections

Two separate alert mechanisms, both fire on the same flagged/blocked events:

**Generic signed webhooks** (`alertDispatch.js`) — for teams/integrations. HMAC-SHA256, timestamp bound into the signature (`t + "." + rawBody`, not the body alone), retries at 1s/5s/25s/2m then a dead-letter queue. Event types: `transaction.flagged`, `transaction.blocked`, `quota.threshold-reached`, `ai.fallback-triggered`. No-ops safely (logs locally) if `ALERT_WEBHOOK_URLS`/`ALERT_WEBHOOK_SECRET` aren't set.

**Personal Telegram alerts** (`connections.js` + `telegramDispatch.js`) — for individuals. Anyone can connect a wallet or agent address to their own dashboard and link a Telegram chat (`/start <code>`); when something they're watching gets flagged, they get pinged directly, scoped only to their own connections, never a broadcast.

- Free tier: 1 connection
- Premium tier: up to 20 connections, unlocked by paying 1 $BOT to `TREASURY_ADDRESS` (verified on-chain by `verifyAndUpgrade()` — checks a real `Transfer` event on `BOT_TOKEN_ADDRESS`, not just that *a* transaction happened)

⚠️ Known gap: `/api/connections/:ownerAddress` has no proof-of-ownership check yet — anyone who knows an address can currently modify its connections. Fine for a demo, needs a signed-message challenge before this is trusted with real accounts.

Setup: create a bot via @BotFather for `TELEGRAM_BOT_TOKEN`, then register the webhook against your deployed backend:
```
curl "https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://yourdomain.com/api/telegram/webhook"
```

## Cryptographic Enforcement Layer (ERC-7579) — designed, not deployed

Everything above is advisory: a verdict the caller can choose to act on. `ShieldGuardValidator7579.sol` + `validationOracle.js` are a from-scratch design for the alternative — enforcement baked into the transaction's actual signature requirements, so skipping the check isn't possible without breaking ECDSA, not just skipping a function call.

**How it works:** an ERC-7579 validator module requires TWO signatures on every `UserOperation` — the agent's own, and a ShieldGuard oracle co-signature. The oracle (`validationOracle.js`) only signs after: deterministic hard-floor rules (unlimited approval, `setApprovalForAll(true)`, ownership-transfer functions — AI can never override these), then simulation (`stateDiffExtractor.js` — catches hidden proxy upgrades and multi-call attacks that pure selector-matching misses), then AI advisory. No oracle signature reaching the chain means `validateUserOp()` returns `VALIDATION_FAILED` and the operation never executes.

**Status, plainly — this is not running anywhere:**
- Not compiled. No Solidity toolchain was available where this was written; `forge build` has never been run against it.
- Signature scheme not runtime-tested (`scripts/test-oracle-signature.mjs` exists but has never executed — needs `npm install` for `ethers`).
- The EIP-1967 implementation-slot constant in `stateDiffExtractor.js` was typed from a source document, not independently computed (no `keccak256` tooling available) — verify with `cast keccak "eip1967.proxy.implementation"` before trusting proxy-upgrade detection.
- Whether BOT Chain's RPC supports `trace_call` (needed for real simulation) is unverified — `stateDiffExtractor.js` falls back to a weaker `eth_call`-only mode if not, which cannot detect proxy upgrades.
- **The actual blocker:** this needs BOT Chain agents on ERC-4337 smart accounts, which don't exist yet. BOT Chain's own "AI Agent Launchpad V1" announcement confirms ERC-4337 support is coming, but gives no date, and doesn't confirm the account implementation will be ERC-7579-modular (i.e., that this validator can actually install into it) rather than a closed/custom account.
- No adversarial test suite yet (prompt-injection attempts, red-pill contracts that behave differently under simulation vs. real execution).
- No dedicated `ORACLE_PRIVATE_KEY` provisioned — must be a separate key from `SIGNER_PRIVATE_KEY`, treated with at least mainnet-deployer-level care, since whoever holds it can forge co-signatures for anything trusting that oracle address.

Next real step: get this in front of a real Foundry setup (`forge build`, then `anvil --fork-url <any chain with EntryPoint already live>` to test against real ERC-4337 infrastructure that already exists elsewhere), run the signature test, then an actual audit — before any of it touches value.

## Quick Start

### 1. Clone & Install

```bash
git clone https://github.com/TonyLegend-77/shieldguard.git
cd shieldguard
npm install
```

### 2. Configure Backend

```bash
cp packages/backend/.env.example packages/backend/.env
# Edit .env with your values:
# - RPC_URL=https://rpc.bohr.life
# - SIGNER_PRIVATE_KEY=0x... (your funded testnet wallet)
# - SIGNER_ADDRESS=0x... (matching address)
```

### 3. Run Locally

```bash
# Terminal 1 — Backend
npm run dev:backend

# Terminal 2 — Frontend
npm run dev:frontend
```

### 4. Test It

1. Approve a spender on WBOT or USDT from your wallet
2. Watch console for: `🚨 FLAGGED` → `Verdict:` → `Signed by:` → `Anchored:`
3. Open http://localhost:3000 for the landing page, then click "Open the dashboard" (or go straight to http://localhost:3000/dashboard) to see it flip to LIVE
4. Or skip waiting for a real event entirely — use the "SDK pre-signing tester" panel on the dashboard to fire a scenario (unlimited approval, blanket NFT approval, etc.) straight at `/api/validate`

## Deployment

### Railway (Backend)

1. Connect GitHub repo to Railway
2. Set root directory: `packages/backend`
3. Add environment variables from `.env.example`
4. First deploy will print contract address in logs
5. Copy address to `RECEIPT_REGISTRY_ADDRESS` env var
6. Redeploy

### Vercel (Frontend)

1. Import GitHub repo
2. Set root directory: `packages/frontend`
3. Add `NEXT_PUBLIC_API_URL=https://your-railway-url.up.railway.app`
4. Deploy

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `RPC_URL` | Yes | BOT Chain RPC (testnet: `https://rpc.bohr.life`) |
| `CHAIN_ID` | Yes | `968` for testnet, `677` for mainnet |
| `WBOT_ADDRESS` | Yes | Wrapped BOT contract address |
| `USDT_ADDRESS` | Yes | USDT contract address |
| `SIGNER_PRIVATE_KEY` | Yes | Funded wallet for signing + deployment |
| `SIGNER_ADDRESS` | Yes | Matching public address |
| `RECEIPT_REGISTRY_ADDRESS` | After deploy | Contract address from first Railway deploy |
| `GEMINI_API_KEY` | No | Primary AI verdict provider (fastest, cheapest) |
| `OPENAI_API_KEY` | No | Falls back to this if Gemini isn't set/fails |
| `ANTHROPIC_API_KEY` | No | Falls back to this if OpenAI isn't set/fails |
| `KNOWN_NFT_OPERATORS` | No | Comma-separated marketplace operator addresses scored lower on `ApprovalForAll` |
| `USE_SQLITE` | No | Set `true` for persistent storage (survives restarts; needs a mounted Railway Volume + `SQLITE_PATH` to survive a full redeploy) |
| `SQLITE_PATH` | No | Path to the `.db` file when `USE_SQLITE=true`, ideally on a mounted volume |
| `PORT` | No | Defaults to `4000` |
| `PUBLIC_TX_LIMIT` | No | Free-tier tx cap per contract, defaults to `20` |
| `PRIVATE_TX_LIMIT` | No | Paid-tier tx cap per contract, defaults to `50` |
| `FREE_TIER_MAX_CONTRACTS` | No | Public contracts allowed per wallet, defaults to `3` |
| `TREASURY_ADDRESS` | For private tier / premium connections | Where $BOT payments (contract tier *and* connections premium) are verified as sent |
| `BOT_TOKEN_ADDRESS` | For private tier / premium connections | $BOT ERC20 contract address — used by both the contract-tier payment check (`webhook.js`) and the connections premium-upgrade check (`connections.js`) |
| `PRIVATE_TIER_PRICE_BOT` | No | $BOT required for private tier, defaults to `5` |
| `ADMIN_API_KEY` | For admin tier | Required as `x-admin-key` header on `/monitor/admin` |
| `MAINNET_RPC_URL` | No | Overrides the `botchainMainnet` Hardhat network RPC, defaults to `https://rpc.botchain.ai` |
| `ALERT_WEBHOOK_URLS` | No | Comma-separated destination URLs for generic signed webhooks. Unset = alerts log locally only |
| `ALERT_WEBHOOK_SECRET` | Required if `ALERT_WEBHOOK_URLS` is set | HMAC signing secret for outbound alerts |
| `TELEGRAM_BOT_TOKEN` | For Telegram alerts | From @BotFather — required for `connections.js`'s personal alert delivery |
| `ORACLE_PRIVATE_KEY` | For the ERC-7579 enforcement layer only | Dedicated co-signing key for `validationOracle.js` — do NOT reuse `SIGNER_PRIVATE_KEY`. Not yet used anywhere in the deployed system (see Cryptographic Enforcement Layer above) |

AI verdicts try providers in order — Gemini, then OpenAI, then Anthropic, then a local template — falling through automatically if a key is missing or the call fails.

Contracts are counted only on transactions ShieldGuard actually signs and anchors on-chain — not raw scans. Admin-added contracts are unlimited; public (free) contracts get `PUBLIC_TX_LIMIT`; private (paid) contracts get `PRIVATE_TX_LIMIT` and auto-deactivate once their limit is hit.

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/alerts` | All recorded events |
| GET | `/guardians` | Watched contracts |
| GET | `/health` | Status + config |
| GET | `/verify/:hash` | Lookup receipt by hash |
| GET | `/signature/address` | Signer public key |
| GET | `/api/stats/global` | Public dashboard totals |
| GET | `/api/alerts/global` | Full public activity feed |
| GET | `/api/user/contracts?address=` | Contracts a wallet added |
| GET | `/api/user/alerts?address=` | Alerts scoped to a wallet's contracts |
| GET | `/api/user/stats?address=` | A wallet's tier + tx usage |
| POST | `/api/validate` | SDK Wrapper — pre-signing check on a raw `{from, to, value, data}` |
| POST | `/api/intent/build` | Intent Router — validate a high-level intent, get back a ready-to-sign tx |
| GET | `/monitor` | List all monitored contracts |
| GET | `/monitor/stats/:address` | Tier/usage stats for one contract |
| GET | `/monitor/limits` | Tx usage/limits for all contracts |
| POST | `/monitor` | Add a public-tier contract (free, capped, dynamically watched) |
| POST | `/monitor/private` | Add a private-tier contract (requires verified `paymentTx` in $BOT) |
| POST | `/monitor/admin` | Add an unlimited contract (requires `x-admin-key` header) |
| DELETE | `/monitor/:address` | Stop watching a contract |
| GET | `/api/connections/:ownerAddress` | Tier, usage, connected wallets/agents, Telegram link status |
| POST | `/api/connections/:ownerAddress` | Connect a wallet/agent (`{ watchAddress, type }`) — enforces free(1)/premium(20) limit |
| DELETE | `/api/connections/:ownerAddress/:watchAddress` | Disconnect |
| POST | `/api/connections/:ownerAddress/telegram/link-code` | Generate a `/start <code>` link code |
| POST | `/api/connections/:ownerAddress/upgrade` | Verify a 1 $BOT payment tx, upgrade to premium |
| POST | `/api/telegram/webhook` | Telegram bot webhook receiver — mount as the bot's registered webhook URL |

## Contract

`ReceiptRegistry.sol` is deployed via Hardhat in the Railway build step. It anchors signature hashes on-chain with metadata for verifiable audit trails.

## Rule Engine

Every detector produces a `{ risk, matched_rules, reason }` result that flows through the same verdict → sign → anchor pipeline:

- **P001/P002** — ERC-20 approval exceeds 10x balance / is unlimited
- **N001/N002** — ERC-721/1155 `setApprovalForAll` to an unrecognized / known operator
- **A001/A002/A003** — ownership transfer (no baseline / from expected owner), pause/unpause
- **T001/T002** — zero-value transfer from a lookalike ("address poisoning") / unmatched address
- **C001** — critical function call matched on a `contractTargets.js`-registered contract

## Threat Corpus

46 entries across 6 tiers, in `bot_chain_threats.jsonl`:
- **G001–G016**: generic EVM attack patterns (approval exploits, honeypots, rug pulls, reentrancy, etc.)
- **H001–H003**: historical exploit case studies (Ronin, Wormhole, Euler)
- **L001–L009**: BOT Chain verified live contracts and network config
- **E001–E003**: ecosystem context (CiaoTool, Meridian, Tandot)
- **P001–P008**: ShieldGuard policy scoring rules
- **N001/N002, A001–A003, T001/T002**: rules for the ApprovalForAll, admin-event, and address-poisoning detectors above

## License

MIT

