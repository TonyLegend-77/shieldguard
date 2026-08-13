import { ethers } from "ethers";

export class SignatureService {
  constructor(privateKey) {
    if (!privateKey) throw new Error("SIGNER_PRIVATE_KEY is required for signing");
    this.wallet = new ethers.Wallet(privateKey);
    console.log("[SignatureService] Signer address:", this.wallet.address);
  }

  getAddress() {
    return this.wallet.address;
  }

  async signVerdict(record, verdict) {
    const payload = JSON.stringify({
      record: {
        token: record.token,
        txHash: record.txHash,
        risk: record.risk,
        matched_rules: record.matched_rules,
        reason: record.reason,
      },
      verdict: {
        summary: verdict.summary,
        recommendation: verdict.recommendation,
        confidence: verdict.confidence,
      },
      timestamp: Date.now(),
    });

    const contentHash = ethers.keccak256(ethers.toUtf8Bytes(payload));
    const signature = await this.wallet.signMessage(ethers.getBytes(contentHash));

    return {
      contentHash,
      signature,
      signerAddress: this.wallet.address,
      payload,
    };
  }

  static verify(contentHash, signature, expectedAddress) {
    const recovered = ethers.verifyMessage(ethers.getBytes(contentHash), signature);
    return recovered.toLowerCase() === expectedAddress.toLowerCase();
  }
}
