# ShieldGuard: BOTChain Security Flight Recorder

A full-stack security monitoring system for BOT Chain that watches token approvals/transfers, flags risky patterns, generates AI verdicts, cryptographically signs findings, and anchors them on-chain.

## Architecture

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   Next.js       │────▶│  Express API    │────▶│  Event Listener │
│   Dashboard     │◄────│  (Railway)      │◄────│  (Ethers.js)    │
│   (Vercel)      │     │                 │     │                 │
└─────────────────┘     └─────────────────┘     └─────────────────┘
                              │                        │
                              ▼                        ▼
                        ┌─────────┐            ┌─────────────┐
                        │ SQLite  │            │ Rule Engine │
                        │ Store   │            │ (P001/P002) │
                        └─────────┘            └─────────────┘
                              │                        │
                              ▼                        ▼
                        ┌─────────┐            ┌─────────────┐
                        │Webhook  │            │ AI Policy   │
                        │/monitor │            │ Engine      │
                        └─────────┘            └─────────────┘
                                                       │
                                                       ▼
                                               ┌─────────────┐
                                               │  Signature  │
                                               │  Service    │
                                               └─────────────┘
                                                       │
                                                       ▼
                                               ┌─────────────┐
                                               │ReceiptRegistry│
                                               │  (Solidity) │
                                               └─────────────┘
```

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
| `USE_SQLITE` | No | Set `true` for persistent storage |
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
| GET | `/guardians` | Watched tokens |
| GET | `/health` | Status + config |
| GET | `/verify/:hash` | Lookup receipt by hash |
| GET | `/signature/address` | Signer public key |
| GET | `/api/stats/global` | Public dashboard totals |
| GET | `/api/alerts/global` | Full public activity feed |
| GET | `/api/user/contracts?address=` | Contracts a wallet added |
| GET | `/api/user/alerts?address=` | Alerts scoped to a wallet's contracts |
| GET | `/api/user/stats?address=` | A wallet's tier + tx usage |
| GET | `/monitor` | List all monitored contracts |
| GET | `/monitor/stats/:address` | Tier/usage stats for one contract |
| GET | `/monitor/limits` | Tx usage/limits for all contracts |
| POST | `/monitor` | Add a public-tier contract (free, capped, dynamically watched) |
| POST | `/monitor/private` | Add a private-tier contract (requires verified `paymentTx` in $BOT) |
| POST | `/monitor/admin` | Add an unlimited contract (requires `x-admin-key` header) |
| DELETE | `/monitor/:address` | Stop watching a contract |

## Contract

`ReceiptRegistry.sol` is deployed via Hardhat in the Railway build step. It anchors signature hashes on-chain with metadata for verifiable audit trails.

## Threat Corpus

33 patterns across 5 tiers:
- **G001-G016**: Generic EVM attack patterns (approval exploits, honeypots, rug pulls, reentrancy, etc.)
- **H001-H003**: Historical exploit case studies (Ronin, Wormhole, Euler)
- **L001-L009**: BOT Chain verified live contracts and network config
- **E001-E003**: Ecosystem context (CiaoTool, Meridian, Tandot)
- **P001-P008**: ShieldGuard policy scoring rules

## License

MIT
