// Run this AFTER `npm install` (needs the `ethers` package, which is not
// installable in the sandbox this was written in — no network access
// there). This has NOT been executed yet. Run it with:
//   node scripts/test-oracle-signature.mjs
// It proves (or disproves) that validationOracle.js's off-chain signing
// scheme produces signatures that match what ShieldGuardValidator7579.sol
// expects to recover on-chain. If any line prints `false`, do not deploy
// the contract until that's resolved — it means the signature scheme
// itself is broken, not just untested.

import { ethers } from "ethers";

// Simulate exactly what ShieldGuardValidator7579.sol does on-chain, in JS,
// to prove the off-chain signing scheme in validationOracle.js._coSign()
// produces a signature the contract's _recover()/_toEthSignedMessageHash()
// logic will actually accept. This does NOT prove the Solidity compiles or
// deploys correctly — only that the signature math is self-consistent.

const oracleWallet = ethers.Wallet.createRandom();
const agentWallet = ethers.Wallet.createRandom();

const userOpHash = ethers.keccak256(ethers.toUtf8Bytes("fake-userop-payload"));
const validUntil = Math.floor(Date.now() / 1000) + 60;

// --- Off-chain side (validationOracle.js._coSign logic) ---
const packed = ethers.solidityPacked(["bytes32", "uint48"], [userOpHash, validUntil]);
const digest = ethers.keccak256(packed);
const oracleSignature = await oracleWallet.signMessage(ethers.getBytes(digest));

const agentSignature = await agentWallet.signMessage(ethers.getBytes(userOpHash));

console.log("Oracle address:", oracleWallet.address);
console.log("Agent address:", agentWallet.address);
console.log("Oracle signature length (bytes):", ethers.getBytes(oracleSignature).length);
console.log("Agent signature length (bytes):", ethers.getBytes(agentSignature).length);

// --- Simulate on-chain verification (what the contract's Solidity does) ---
// agentSignedHash = toEthSignedMessageHash(userOpHash)
const recoveredAgent = ethers.verifyMessage(ethers.getBytes(userOpHash), agentSignature);
console.log("Recovered agent matches:", recoveredAgent === agentWallet.address);

// oracleSignableHash = toEthSignedMessageHash(keccak256(abi.encodePacked(userOpHash, validUntil)))
const recoveredOracle = ethers.verifyMessage(ethers.getBytes(digest), oracleSignature);
console.log("Recovered oracle matches:", recoveredOracle === oracleWallet.address);

// Tamper test: change validUntil by 1 second, signature should NOT verify against new digest
const tamperedPacked = ethers.solidityPacked(["bytes32", "uint48"], [userOpHash, validUntil + 1]);
const tamperedDigest = ethers.keccak256(tamperedPacked);
const recoveredTampered = ethers.verifyMessage(ethers.getBytes(tamperedDigest), oracleSignature);
console.log("Tampered validUntil recovers to WRONG address (expected true):", recoveredTampered !== oracleWallet.address);

// Full 136-byte signature packing test, matching userOp.signature layout
const validUntilHex = ethers.zeroPadValue(ethers.toBeHex(validUntil), 6);
const fullSignature = ethers.concat([agentSignature, oracleSignature, validUntilHex]);
console.log("Full packed signature length (bytes):", ethers.getBytes(fullSignature).length, "(expect 136)");

// Unpack exactly as the contract does: [0:65] agent, [65:130] oracle, [130:136] validUntil
const unpacked = ethers.getBytes(fullSignature);
const unpackedAgentSig = ethers.hexlify(unpacked.slice(0, 65));
const unpackedOracleSig = ethers.hexlify(unpacked.slice(65, 130));
const unpackedValidUntilBytes = unpacked.slice(130, 136);
const unpackedValidUntil = Number(ethers.toBigInt(unpackedValidUntilBytes));

console.log("Unpacked agent sig matches original:", unpackedAgentSig === agentSignature);
console.log("Unpacked oracle sig matches original:", unpackedOracleSig === oracleSignature);
console.log("Unpacked validUntil matches original:", unpackedValidUntil === validUntil);
