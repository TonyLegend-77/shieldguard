import "dotenv/config";
import { JsonRpcProvider, Contract, Wallet } from "ethers";
import { evaluateApproval } from "./ruleEngine.js";
import { registerGuardian, recordEvent } from "./store.js";
import { startServer } from "./server.js";
import { generateVerdict } from "./policyEngine.js";
import { SignatureService } from "./signatureService.js";

function short(addr) {
  return addr ? `${addr.slice(0, 6)}...${addr.slice(-4)}` : addr;
}

const ERC20_ABI = [
  "event Approval(address indexed owner, address indexed spender, uint256 value)",
  "event Transfer(address indexed from, address indexed to, uint256 value)",
  "function balanceOf(address account) view returns (uint256)",
];

const TARGETS = [
  { name: "WBOT", address: process.env.WBOT_ADDRESS },
  { name: "USDT", address: process.env.USDT_ADDRESS },
];

let signatureService = null;
if (process.env.SIGNER_PRIVATE_KEY) {
  signatureService = new SignatureService(process.env.SIGNER_PRIVATE_KEY);
}

let receiptRegistry = null;
if (
  process.env.RECEIPT_REGISTRY_ADDRESS &&
  process.env.SIGNER_PRIVATE_KEY &&
  process.env.RPC_URL
) {
  const provider = new JsonRpcProvider(process.env.RPC_URL);
  const signer = new Wallet(process.env.SIGNER_PRIVATE_KEY, provider);
  const REGISTRY_ABI = [
    "function anchorReceipt(bytes32 contentHash, string calldata metadata) external",
    "function verifyReceipt(bytes32 contentHash) external view returns (tuple(bytes32 contentHash, string metadata, uint256 timestamp, address submitter))",
    "function isAnchored(bytes32 contentHash) external view returns (bool)",
    "event ReceiptAnchored(bytes32 indexed contentHash, uint256 timestamp, string metadata, address submitter)",
  ];
  receiptRegistry = new Contract(
    process.env.RECEIPT_REGISTRY_ADDRESS,
    REGISTRY_ABI,
    signer
  );
  console.log("[listener] ReceiptRegistry connected:", process.env.RECEIPT_REGISTRY_ADDRESS);
} else {
  console.log("[listener] ReceiptRegistry not configured — anchoring disabled.");
}

async function main() {
  if (!process.env.RPC_URL) {
    console.error("Set RPC_URL in .env. Confirmed testnet: https://rpc.bohr.life");
    process.exit(1);
  }

  const provider = new JsonRpcProvider(process.env.RPC_URL);
  provider.pollingInterval = 4000;

  console.log(`ShieldGuard listener on chain ${process.env.CHAIN_ID || "unknown"}...`);
  startServer();

  for (const target of TARGETS) {
    if (!target.address) {
      console.warn(`Skipping ${target.name}: no address in .env`);
      continue;
    }

    const contract = new Contract(target.address, ERC20_ABI, provider);
    console.log(`Watching ${target.name} (${target.address})`);
    registerGuardian(target.name, target.address);

    contract.on("Approval", async (owner, spender, value, event) => {
      try {
        const ownerBalance = await contract.balanceOf(owner);
        const result = evaluateApproval({ owner, spender, value, ownerBalance });

        const record = {
          token: target.name,
          tokenAddress: target.address,
          txHash: event.log.transactionHash,
          timestamp: new Date().toISOString(),
          ...result,
        };

        let verdict = null;
        let signatureData = null;
        let anchored = false;

        if (result.risk !== "LOW") {
          console.log("🚨 FLAGGED:", JSON.stringify(record, null, 2));

          try {
            verdict = await generateVerdict(record);
            console.log("[verdict]", verdict.summary);
          } catch (err) {
            console.error("[verdict] Error:", err.message);
          }

          if (signatureService && verdict) {
            try {
              signatureData = await signatureService.signVerdict(record, verdict);
              console.log("[signed] By:", signatureData.signerAddress);
            } catch (err) {
              console.error("[signed] Error:", err.message);
            }
          }

          if (receiptRegistry && signatureData) {
            try {
              const alreadyAnchored = await receiptRegistry.isAnchored(signatureData.contentHash);
              if (!alreadyAnchored) {
                const tx = await receiptRegistry.anchorReceipt(
                  signatureData.contentHash,
                  JSON.stringify({
                    token: target.name,
                    risk: result.risk,
                    rules: result.matched_rules,
                  })
                );
                await tx.wait();
                anchored = true;
                console.log("[anchor] ✅ Anchored:", signatureData.contentHash.slice(0, 20) + "...");
              } else {
                console.log("[anchor] Already anchored:", signatureData.contentHash.slice(0, 20) + "...");
              }
            } catch (err) {
              console.error("[anchor] Error:", err.message);
            }
          }
        } else {
          console.log(`[${target.name}] Approval OK — ${short(owner)} -> ${short(spender)}`);
        }

        recordEvent({
          token: target.name,
          tokenAddress: target.address,
          from: short(owner),
          to: short(spender),
          severity: result.risk,
          reason: result.reason,
          rules: result.matched_rules,
          txHash: event.log.transactionHash,
          signed: !!signatureData,
          hash: signatureData?.contentHash || null,
          verdict: verdict?.summary || null,
          anchored,
        });
      } catch (err) {
        console.error(`[${target.name}] Error:`, err.message);
      }
    });

    contract.on("Transfer", (from, to, value, event) => {
      console.log(`[${target.name}] Transfer ${short(from)} -> ${short(to)}`);
      recordEvent({
        token: target.name,
        tokenAddress: target.address,
        from: short(from),
        to: short(to),
        severity: "LOW",
        reason: "Standard transfer, no risk signals",
        rules: [],
        txHash: event.log.transactionHash,
        signed: false,
        hash: null,
        verdict: null,
        anchored: false,
      });
    });
  }

  console.log("Listening (polling every 4s)... leave this running.");
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
