# ShieldGuard — Live On-Chain Threat Monitoring for BOT Chain

ShieldGuard watches BOT Chain in real time, scores suspicious activity against a rule engine and an AI policy layer, cryptographically signs every verdict, and anchors it permanently on-chain — so a flagged threat can't be quietly edited or disputed after the fact. It also ships a non-custodial SDK so AI agents can get the same checks *before* they ever sign a transaction, not just after.

## What it actually watches

**On-chain, event-based** (polled every ~4s, `packages/backend/src/listener.js`):
- `Approval` — unlimited approvals, approvals exceeding 10x the owner's balance
- `Transfer` — zero-value "address poisoning" transfers from lookalike addresses
- `ApprovalForAll` (ERC-721/1155) — blanket collection-wide approvals to unrecognized operators, the mechanism behind most NFT drainer kits
- `OwnershipTransferred`, `Paused`, `Unpaused` — admin/owner privileged-call monitoring, distinct from user-wallet risk

**On-chain, transaction-based** (`contractTargets.js`): for contracts with no standard event to watch, ShieldGuard pulls each full block and matches `tx.data`'s 4-byte selector against a per-contract map of real function selectors (read directly off verified source on scan.bohr.life) — catching calls to things like `submitTransaction`, `stake`, `placeBid`, `mint` even when nothing gets logged.

**Pre-signing, via HTTP** (`POST /api/validate`, `POST /api/intent/build`): the same rule engine runs against proposed calldata *before* a transaction is signed — decoding `approve`, `setApprovalForAll`, `transfer`/`transferFrom`, and any mapped critical-function call. This is what `@shieldguard/sdk` calls under the hood.

Every flagged result — regardless of which detector caught it — runs through one shared pipeline: AI verdict → cryptographic signature → on-chain anchor via `ReceiptRegistry.sol` → recorded to the dashboard.

## Architecture

```
┌─────────────────┐     ┌──────────────────┐     ┌──────────────────┐
│   Next.js        │────▶│  Express API     │────▶│  Event Listener  │
│   Dashboard       │◄────│  (Railway)       │◄────│  (Ethers.js)     │
│   (Vercel)        │     │                  │     │                 │
└─────────────────┘     └──────────────────┘     └──────────────────┘
                              │      │                    │
                              ▼      ▼                    ▼
                      ┌─────────┐ ┌──────────┐    ┌──────────────────┐
                      │ Store    │ │ Webhook  │    │  Rule Engine      │
                      │(memory or│ │ /monitor │    │ (P/N/A/T/C rules) │
                      │ SQLite)  │ └──────────┘    └──────────────────┘
                      └─────────┘                          │
                                                            ▼
                                                    ┌──────────────────┐
                                                    │  AI Policy Engine │
                                                    │ (Gemini→OpenAI→   │
                                                    │  Anthropic→local) │
                                                    └──────────────────┘
                                                            │
                                                            ▼
                                                    ┌──────────────────┐
                                                    │ Signature Service │
                                                    └──────────────────┘
                                                            │
                                                            ▼
                                                    ┌──────────────────┐
                                                    │ ReceiptRegistry   │
                                                    │   (Solidity)      │
                                                    └──────────────────┘

┌──────────────────┐
│ @shieldguard/sdk  │──── HTTP only, no shared code ────▶  POST /api/validate
│ (agents/wallets)  │──── HTTP only, no shared code ────▶  POST /api/intent/build
└──────────────────┘
```

## Non-custodial agent firewall (`packages/sdk`)

AI agents holding their own keys are a major drain vector — a compromised or prompt-injected agent can sign anything it's tricked into. `@shieldguard/sdk` wraps any ethers.js signer and checks every transaction with ShieldGuard before it's signed:

```js
import { ShieldGuardSigner } from '@shieldguard/sdk';

const signer = new ShieldGuardSigner(agentWallet, { apiUrl: 'https://your-backend.up.railway.app' });
await signer.sendTransaction(tx); // throws if ShieldGuard flags it — never reaches the real signer
```

ShieldGuard never holds a key, never touches gas, and never signs anything on the agent's behalf — it only returns a verdict. Agents that would rather describe *what* they want than build calldata can use the Intent Router (`buildIntent`) instead, which validates a high-level action (`approve`, `setApprovalForAll`, `transfer`) and returns a ready-to-sign tx for the caller's own wallet.

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
3. Open http://localhost:3000 to see the dashboard flip to LIVE
4. Or skip waiting for a real event entirely — use the "SDK PRE-SIGNING TESTER" panel on the live site to fire a scenario (unlimited approval, blanket NFT approval, etc.) straight at `/api/validate`

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
| `TREASURY_ADDRESS` | For private tier | Where $BOT payments are verified as sent |
| `BOT_TOKEN_ADDRESS` | For private tier | $BOT ERC20 contract address |
| `PRIVATE_TIER_PRICE_BOT` | No | $BOT required for private tier, defaults to `5` |
| `ADMIN_API_KEY` | For admin tier | Required as `x-admin-key` header on `/monitor/admin` |

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
