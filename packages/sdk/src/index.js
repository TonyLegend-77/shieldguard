import { ethers } from "ethers";

/**
 * ShieldGuardSigner — SDK Wrapper pattern.
 *
 * Wraps any ethers.js Signer (a wallet, an agent's key, MetaMask via
 * BrowserProvider, etc.) and intercepts sendTransaction() calls, checking
 * each one against your ShieldGuard backend's /api/validate endpoint before
 * forwarding it to the real signer.
 *
 * Non-custodial by design: this SDK never holds a private key and never
 * talks to ShieldGuard's backend source code directly — only plain HTTP
 * calls to whatever apiUrl you point it at. Nothing here can leak backend
 * secrets, because it never imports backend code.
 */
export class ShieldGuardSigner {
  constructor(innerSigner, config = {}) {
    if (!innerSigner) throw new Error("ShieldGuard: innerSigner is required");
    if (!config.apiUrl) throw new Error("ShieldGuard: apiUrl is required (e.g. your Railway backend URL)");

    this.innerSigner = innerSigner;
    this.config = {
      apiUrl: config.apiUrl.replace(/\/$/, ""),
      apiKey: config.apiKey || null,
      // fail-closed by default: if ShieldGuard's API is unreachable, block
      // the transaction rather than silently letting it through.
      strictMode: config.strictMode !== false,
      timeout: config.timeout || 5000,
    };

    this.listeners = { onBlock: [], onApprove: [] };
  }

  onBlock(callback) {
    this.listeners.onBlock.push(callback);
  }

  onApprove(callback) {
    this.listeners.onApprove.push(callback);
  }

  get provider() {
    return this.innerSigner.provider;
  }

  async getAddress() {
    return this.innerSigner.getAddress();
  }

  async signMessage(message) {
    return this.innerSigner.signMessage(message);
  }

  connect(provider) {
    return new ShieldGuardSigner(this.innerSigner.connect(provider), this.config);
  }

  /**
   * Core interception. Populates the tx, asks ShieldGuard for a verdict,
   * then either throws (blocked) or forwards to the real signer (approved).
   */
  async sendTransaction(txRequest) {
    const tx = await this.innerSigner.populateTransaction(txRequest);

    let verdict;
    try {
      verdict = await this._queryPolicyEngine(tx);
    } catch (apiError) {
      if (this.config.strictMode) {
        throw new Error(`ShieldGuard API unreachable (${apiError.message}) — transaction blocked for safety.`);
      }
      console.warn("[ShieldGuard] API unreachable, failing open (strictMode=false):", apiError.message);
      return this.innerSigner.sendTransaction(txRequest);
    }

    if (verdict.recommendation === "REVOKE_IMMEDIATELY") {
      const blockError = new Error(
        `Blocked by ShieldGuard: ${verdict.summary} (confidence ${Math.round((verdict.confidence ?? 0) * 100)}%)`
      );
      this.listeners.onBlock.forEach((cb) => cb({ tx, verdict, error: blockError }));
      throw blockError;
    }

    this.listeners.onApprove.forEach((cb) => cb({ tx, verdict }));
    return this.innerSigner.sendTransaction(tx);
  }

  async _queryPolicyEngine(tx) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.config.timeout);

    try {
      const payload = {
        from: await this.getAddress(),
        to: tx.to,
        value: tx.value?.toString() || "0",
        data: tx.data || "0x",
      };

      const headers = { "Content-Type": "application/json" };
      if (this.config.apiKey) headers["Authorization"] = `Bearer ${this.config.apiKey}`;

      const response = await fetch(`${this.config.apiUrl}/api/validate`, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      if (!response.ok) throw new Error(`API returned ${response.status}`);
      return await response.json();
    } finally {
      clearTimeout(timeoutId);
    }
  }
}

/**
 * Helper to wrap a browser wallet (MetaMask etc.) in one call.
 */
export async function createShieldGuardBrowserWallet(apiUrl, config = {}) {
  if (typeof window === "undefined" || !window.ethereum) {
    throw new Error("ShieldGuard: window.ethereum not found — call this in a browser with a wallet extension installed.");
  }
  const browserProvider = new ethers.BrowserProvider(window.ethereum);
  const signer = await browserProvider.getSigner();
  return new ShieldGuardSigner(signer, { apiUrl, ...config });
}

/**
 * Intent Router — for agents that would rather describe *what* they want
 * to do than build raw calldata themselves. Sends a high-level intent to
 * ShieldGuard's backend, which validates it and returns a ready-to-sign
 * transaction. Still non-custodial: the caller's own signer signs and
 * broadcasts the returned tx — ShieldGuard never touches a private key.
 *
 * Supported actions: "approve", "setApprovalForAll", "transfer"
 *
 * Example:
 *   const result = await buildIntent(apiUrl, {
 *     action: "approve", from: agentAddress, token: usdtAddress,
 *     spender: routerAddress, amount: "1000000"
 *   });
 *   if (result.approved) {
 *     const receipt = await signer.sendTransaction(result.tx);
 *   }
 */
export async function buildIntent(apiUrl, intent, config = {}) {
  const headers = { "Content-Type": "application/json" };
  if (config.apiKey) headers["Authorization"] = `Bearer ${config.apiKey}`;

  const response = await fetch(`${apiUrl.replace(/\/$/, "")}/api/intent/build`, {
    method: "POST",
    headers,
    body: JSON.stringify(intent),
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || `Intent build failed: API returned ${response.status}`);
  }

  return response.json();
}
