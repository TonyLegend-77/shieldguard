// Minimal ERC20 `transfer(address,uint256)` calldata encoder. No ethers/viem
// dependency on the frontend — this is the one call we need, hand-encoded.

const TRANSFER_SELECTOR = 'a9059cbb';

function encodeTransfer(toAddress, amountWei) {
  const toPadded = toAddress.toLowerCase().replace('0x', '').padStart(64, '0');
  const amountPadded = amountWei.toString(16).padStart(64, '0');
  return '0x' + TRANSFER_SELECTOR + toPadded + amountPadded;
}

// amountBOT is a plain integer/decimal number of whole $BOT tokens (e.g. 5).
// Assumes 18 decimals, matching every other BOT Chain ERC20 in this repo.
export function botToWei(amountBOT) {
  const [whole, frac = ''] = String(amountBOT).split('.');
  const fracPadded = (frac + '0'.repeat(18)).slice(0, 18);
  return BigInt(whole || '0') * 10n ** 18n + BigInt(fracPadded || '0');
}

// Sends the $BOT payment straight from the connected wallet and returns the
// tx hash once submitted (does NOT wait for confirmation — the backend's
// /monitor/private route waits for and verifies the receipt itself).
export async function sendBotPayment({ fromAddress, tokenAddress, treasuryAddress, amountBOT }) {
  if (!window.ethereum) throw new Error('No wallet provider found');
  const data = encodeTransfer(treasuryAddress, botToWei(amountBOT));

  const txHash = await window.ethereum.request({
    method: 'eth_sendTransaction',
    params: [{ from: fromAddress, to: tokenAddress, data }],
  });

  return txHash;
}
