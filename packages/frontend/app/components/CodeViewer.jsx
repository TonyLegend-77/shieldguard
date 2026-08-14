'use client';

import { useState } from 'react';

const TABS = {
  solidity: {
    label: 'ShieldGuardValidator7579.sol',
    code: `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

// NOT YET DEPLOYED — written against ERC-7579 + ERC-4337 v0.7 spec,
// not tested against a live EntryPoint. See contract header comment.
contract ShieldGuardValidator7579 is IERC7579Validator {
  mapping(address => address) public accountOracle;
  mapping(address => address) public accountAgentOwner;

  function validateUserOp(
    PackedUserOperation calldata userOp,
    bytes32 userOpHash
  ) external view returns (uint256 validationData) {
    // signature = [agent sig (0..65) | oracle sig (65..130) | expiry]
    bytes memory oracleSig = userOp.signature[65:130];
    if (block.timestamp > validUntil) return VALIDATION_FAILED;

    address recovered = keccak256(abi.encodePacked(userOpHash, validUntil))
      .toEthSignedMessageHash()
      .recover(oracleSig);

    if (recovered != accountOracle[userOp.sender]) return VALIDATION_FAILED;
    return VALIDATION_SUCCESS;
  }
}`,
  },
  typescript: {
    label: 'client.ts',
    code: `import { ShieldGuardSigner } from '@shieldguard/sdk';

const signer = new ShieldGuardSigner({
  apiUrl: process.env.SHIELDGUARD_API_URL,
});

// Real endpoint, wired up in server.js — see validationOracle.js.
const result = await fetch(\`\${apiUrl}/api/oracle/evaluate\`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ sender, to, data, value, context }),
}).then((r) => r.json());

if (result.decision === 'BLOCK') {
  throw new Error(\`Blocked: \${result.reason}\`);
}
// result.oracleSignature + result.validUntil are ready to attach
// to the UserOperation's signature field.`,
  },
  webhook: {
    label: 'verify-webhook.js',
    code: `const crypto = require('crypto');

// Matches signatureService.js on the backend — HMAC-SHA256 over the
// raw request body, timing-safe compare.
function verifyWebhook(body, signature, secret) {
  const hmac = crypto.createHmac('sha256', secret).update(body).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(hmac), Buffer.from(signature));
}`,
  },
};

export default function CodeViewer() {
  const [tab, setTab] = useState('solidity');

  return (
    <div className="rounded-lg border border-line bg-surface overflow-hidden">
      <div className="flex border-b border-line bg-surfaceAlt text-xs font-mono overflow-x-auto">
        {Object.entries(TABS).map(([key, t]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`px-4 py-2.5 border-b-2 whitespace-nowrap transition-colors ${
              tab === key ? 'border-accent text-ink font-medium bg-surface' : 'border-transparent text-dim hover:text-ink'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      <pre className="p-4 text-[11px] font-mono text-ink overflow-x-auto leading-relaxed bg-surface">
        {TABS[tab].code}
      </pre>
    </div>
  );
}
