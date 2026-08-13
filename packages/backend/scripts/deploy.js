import hre from "hardhat";
import { writeFileSync, existsSync, readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MARKER_PATH = join(__dirname, "..", "contract-address.txt");

async function main() {
  // Skip if already deployed (address in env or marker file)
  if (process.env.RECEIPT_REGISTRY_ADDRESS) {
    console.log("[deploy] Using existing contract:", process.env.RECEIPT_REGISTRY_ADDRESS);
    return;
  }

  if (existsSync(MARKER_PATH)) {
    const addr = readFileSync(MARKER_PATH, "utf-8").trim();
    console.log("[deploy] Found marker file:", addr);
    console.log("[deploy] Add RECEIPT_REGISTRY_ADDRESS=" + addr + " to your Railway env and restart.");
    return;
  }

  if (!process.env.SIGNER_PRIVATE_KEY) {
    console.error("[deploy] SIGNER_PRIVATE_KEY not set. Cannot deploy.");
    process.exit(1);
  }

  const [deployer] = await hre.ethers.getSigners();
  const balance = await hre.ethers.provider.getBalance(deployer.address);

  console.log("[deploy] Deployer:", deployer.address);
  console.log("[deploy] Balance:", hre.ethers.formatEther(balance), "BOT");

  if (balance === 0n) {
    console.error("[deploy] Deployer has zero balance. Get testnet BOT from the faucet first.");
    process.exit(1);
  }

  console.log("[deploy] Compiling ReceiptRegistry...");
  const ReceiptRegistry = await hre.ethers.getContractFactory("ReceiptRegistry");

  console.log("[deploy] Sending deploy transaction...");
  const registry = await ReceiptRegistry.deploy();
  await registry.waitForDeployment();

  const address = await registry.getAddress();
  console.log("[deploy] ✅ ReceiptRegistry deployed to:", address);

  // Write marker file
  writeFileSync(MARKER_PATH, address);

  // Print in Railway-friendly format
  console.log("
╔════════════════════════════════════════════════════════════╗");
  console.log("║  ADD THIS TO RAILWAY ENVIRONMENT VARIABLES                 ║");
  console.log("╠════════════════════════════════════════════════════════════╣");
  console.log("║  RECEIPT_REGISTRY_ADDRESS=" + address + "  ║");
  console.log("╚════════════════════════════════════════════════════════════╝
");

  console.log("[deploy] Then restart the Railway service to pick it up.");
}

main().catch((error) => {
  console.error("[deploy] Failed:", error);
  process.exit(1);
});
