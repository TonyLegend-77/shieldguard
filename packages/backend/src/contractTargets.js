// Shared list of contracts under generic function-call monitoring.
// Both listener.js (live on-chain watching) and server.js (SDK/agent
// pre-signing checks via /api/validate and /api/intent/build) import this
// same list, so an agent using @shieldguard/sdk gets flagged for the exact
// same critical functions the on-chain monitor would catch after the fact.
//
// Generic contract-call monitoring: unlike Approval/Transfer/ApprovalForAll/
// admin events above, arbitrary functions have no shared event to poll, so
// we watch raw transactions sent to these addresses and match the 4-byte
// function selector (tx.data[0:10]) against a known map. Selectors marked
// below were read directly off verified source on scan.bohr.life (Write
// Contract tab) — entries with an empty functionSelectors map are
// registered as Guardians for visibility only; calls won't be decoded
// until their selectors are filled in the same way.
export const CONTRACT_TARGETS = [
  {
    name: "TokenFactory",
    address: "0xa3b71D74bA6E26f37deD0e34A36478E4a99EFDA1",
    tier: "public",
    criticalFunctions: ["createToken", "deploy"],
    functionSelectors: {
      "0xf5e429a4": "createToken",
      "0x8406128f": "createTokenInternal",
      "0x715018a6": "renounceOwnership",
      "0xf2fde38b": "transferOwnership",
      "0x64464897": "updateAgentRegistry",
      "0x172dd37a": "updateTokenCreationFee",
      "0x476343ee": "withdrawFees",
    },
  },
  {
    name: "MultiSigWallet",
    address: "0x1B29765AE3a01551B1374b61B795B8D414BBE78a",
    tier: "admin",
    criticalFunctions: [
      "submitTransaction",
      "confirmTransaction",
      "executeTransactionManual",
      "submitAddOwner",
      "removeOwnerInternal",
      "submitChangeMinOwners",
      "submitChangeRequiredPct",
    ],
    functionSelectors: {
      "0xc01a8c84": "confirmTransaction",
      "0x40a70f9d": "confirmTransactionsBatch",
      "0x360003cb": "executeTransactionManual",
      "0x8456cb59": "pause",
      "0xb90ae498": "removeOwnerInternal",
      "0xb8d2cb9d": "submitAddOwner",
      "0x5c02380d": "submitBatchTransferDifferent",
      "0xc2e1c8cb": "submitBatchTransferEqual",
      "0x99413cac": "submitChangeExpiry",
      "0xfa891262": "submitChangeMinOwners",
      "0x82554fb1": "submitChangeName",
      "0xef1dadd2": "submitChangeRequiredPct",
      "0x05520407": "submitChangeTimelock",
      "0x92406f19": "submitTransaction",
      "0x3f4ba83a": "unpause",
    },
  },
  {
    name: "MultiSigWallet",
    address: "0x8e0A44464b2459414edD900bD8D68ac923Eb53de",
    tier: "admin",
    // Same contract code as the 0x1B29... deployment — confirmed identical
    // function list on scan.bohr.life, just a separate instance.
    criticalFunctions: [
      "submitTransaction",
      "confirmTransaction",
      "executeTransactionManual",
      "submitAddOwner",
      "removeOwnerInternal",
      "submitChangeMinOwners",
      "submitChangeRequiredPct",
    ],
    functionSelectors: {
      "0xc01a8c84": "confirmTransaction",
      "0x40a70f9d": "confirmTransactionsBatch",
      "0x360003cb": "executeTransactionManual",
      "0x8456cb59": "pause",
      "0xb90ae498": "removeOwnerInternal",
      "0xb8d2cb9d": "submitAddOwner",
      "0x5c02380d": "submitBatchTransferDifferent",
      "0xc2e1c8cb": "submitBatchTransferEqual",
      "0x99413cac": "submitChangeExpiry",
      "0xfa891262": "submitChangeMinOwners",
      "0x82554fb1": "submitChangeName",
      "0xef1dadd2": "submitChangeRequiredPct",
      "0x05520407": "submitChangeTimelock",
      "0x92406f19": "submitTransaction",
      "0x3f4ba83a": "unpause",
    },
  },
  { name: "CompanyWallet", address: "0x33A4ad07A724A8b300b80bFa0B0B451F3F2E50e6", tier: "admin", criticalFunctions: ["transfer", "approve"], functionSelectors: {} },
  {
    name: "NyxBatchAuction",
    address: "0x58126ae8ff411a3B1768b121763a0E999221b6da",
    tier: "public",
    criticalFunctions: ["submitOrder", "settleBatch", "cancelOrder"],
    functionSelectors: {
      "0xdf45908a": "submitOrder",
      "0xa141f148": "settleBatch",
      "0x7489ec23": "cancelOrder",
      "0x53eb1a09": "acceptAgent",
      "0xbcf685ed": "setAgent",
    },
  },
  { name: "NyxBatchAuction", address: "0xC0405E50D1BF816B9Fb1A741Cb46941828c378ea", tier: "public", criticalFunctions: ["submitOrder", "settleBatch", "cancelOrder"], functionSelectors: {} },
  { name: "Wattline", address: "0x9D0ED40615845ee6134F475AcCF35e0412CA1EdF", tier: "public", criticalFunctions: ["stake", "withdraw", "claim"], functionSelectors: {} },
  { name: "GaslessGuest", address: "0x5D43267c50b457B58cb94577aa977C5CD21cc071", tier: "public", criticalFunctions: ["execute", "relay"], functionSelectors: {} },
  { name: "MockSwap", address: "0x6935B8ADD1ad176b73370F45b603Df30a303EF02", tier: "public", criticalFunctions: ["swap", "addLiquidity", "removeLiquidity"], functionSelectors: {} },
  {
    name: "AgentAuth",
    address: "0x3dBBd27D26d2AA3ed321A785C0513969f1fB23B8",
    tier: "admin",
    criticalFunctions: ["grantRole", "revokeRole", "mint"],
    functionSelectors: {
      "0x095ea7b3": "approve",
      "0x42966c68": "burn",
      "0x79cc6790": "burnFrom",
      "0x2f2ff15d": "grantRole",
      "0x40c10f19": "mint",
      "0x36568abe": "renounceRole",
      "0xd547741f": "revokeRole",
      "0xa9059cbb": "transfer",
      "0x23b872dd": "transferFrom",
    },
  },
  { name: "PokerTable", address: "0x8D9Addf007461AB959369eD77df6363e41B8982d", tier: "public", criticalFunctions: ["joinTable", "leaveTable", "distributeWinnings"], functionSelectors: {} },
];

// Looks up a target by contract address (case-insensitive) and, if the
// given selector decodes to one of that target's criticalFunctions,
// returns the function name. Returns null otherwise — either the address
// isn't in CONTRACT_TARGETS, the selector isn't mapped yet, or the
// function it maps to isn't on that contract's critical list.
export function matchCriticalCall(toAddress, selector) {
  if (!toAddress || !selector) return null;
  const target = CONTRACT_TARGETS.find((t) => t.address.toLowerCase() === toAddress.toLowerCase());
  if (!target) return null;

  const functionName = target.functionSelectors[selector.toLowerCase()];
  if (!functionName) return null;
  if (!target.criticalFunctions.includes(functionName)) return null;

  return { target, functionName };
}
