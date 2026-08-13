import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const address = process.argv[2];
if (!address) {
  console.error("Usage: node scripts/verify.js 0xYourContractAddress");
  process.exit(1);
}

const source = readFileSync(join(__dirname, "..", "contracts", "ReceiptRegistry.sol"), "utf-8");
const payload = {
  contractaddress: address,
  contractname: "ReceiptRegistry",
  compilerversion: "v0.8.19+commit.7dd6d404",
  optimizationUsed: "1", runs: "200",
  sourceCode: source, codeformat: "solidity-single-file",
  constructorArguements: "", evmversion: "paris", licenseType: "3",
};

console.log("=== VERIFICATION PAYLOAD ===");
console.log(JSON.stringify(payload, null, 2));
console.log("==========================");
console.log("Paste into explorer if they add verification. Contract works unverified.");
