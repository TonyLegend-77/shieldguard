'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

const STORAGE_KEY = 'sg_wallet';
const STORAGE_KIND_KEY = 'sg_wallet_kind'; // 'injected' | 'walletconnect'
const TARGET_CHAIN_ID = parseInt(process.env.NEXT_PUBLIC_CHAIN_ID || '968', 10);
const CHAIN_HEX = '0x' + TARGET_CHAIN_ID.toString(16);
const WC_PROJECT_ID = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || '';

// Module-level (not React state) so the standalone sendRawTransaction()
// helper below can reach whichever provider is currently connected —
// injected (window.ethereum) or WalletConnect — without needing the
// useWallet() hook's state threaded through every call site.
let activeProvider = null;
let walletConnectProvider = null; // cached instance, WalletConnect setup is expensive to redo

// Lazily loads and initializes the WalletConnect provider. Only imported
// when actually needed (no injected wallet found) so desktop users with
// MetaMask never pull in this dependency at all.
async function getWalletConnectProvider() {
  if (walletConnectProvider) return walletConnectProvider;
  if (!WC_PROJECT_ID) {
    throw new Error(
      'WalletConnect is not configured (NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID missing). Get a free project ID at https://cloud.reown.com.'
    );
  }
  const { EthereumProvider } = await import('@walletconnect/ethereum-provider');
  walletConnectProvider = await EthereumProvider.init({
    projectId: WC_PROJECT_ID,
    chains: [TARGET_CHAIN_ID],
    optionalChains: [TARGET_CHAIN_ID],
    showQrModal: true,
    metadata: {
      name: 'ShieldGuard',
      description: 'Catch the drain before it happens.',
      url: typeof window !== 'undefined' ? window.location.origin : 'https://shieldguard.example.com',
      icons: [],
    },
  });
  return walletConnectProvider;
}

// Standalone helper (not part of useWallet) — sends one raw transaction via
// whichever EIP-1193 provider is currently connected (injected or
// WalletConnect). Used after the Intent Router returns a ready-to-sign
// { to, data, value } so the connected wallet can actually sign and
// broadcast it, closing the loop from intent -> verdict -> tx.
export async function sendRawTransaction({ from, to, data, value }) {
  const provider = getActiveProvider();
  if (!provider) {
    throw new Error('No wallet provider found — connect a wallet first.');
  }
  if (!from || !to) throw new Error('from and to are required to send a transaction.');

  // eth_sendTransaction wants value as a 0x-prefixed hex string, but
  // /api/intent/build returns it as a decimal string (e.g. "0").
  const hexValue = '0x' + BigInt(value || '0').toString(16);

  const txHash = await provider.request({
    method: 'eth_sendTransaction',
    params: [{ from, to, data: data || '0x', value: hexValue }],
  });

  return txHash;
}

export function getActiveProvider() {
  return activeProvider || (typeof window !== 'undefined' ? window.ethereum : null);
}
//  1. Injected EIP-1193 provider (window.ethereum) — desktop extensions,
//     or inside a wallet app's own in-app browser.
//  2. WalletConnect — everything else, most importantly mobile Safari/
//     Chrome, where there's no extension to inject anything. Shows a QR
//     code on desktop or a wallet-app picker / deep link on mobile.
// Deliberately no wagmi dependency: just an address, a chain id, and the
// ability to send one raw transaction for the private-tier payment.
export function useWallet() {
  const [address, setAddress] = useState(null);
  const [chainId, setChainId] = useState(null);
  const [connecting, setConnecting] = useState(false);
  const [hasProvider, setHasProvider] = useState(false);
  const [providerKind, setProviderKind] = useState(null); // 'injected' | 'walletconnect' | null
  const wcSupported = Boolean(WC_PROJECT_ID);
  const cleanupRef = useRef(null);

  const attachInjectedListeners = useCallback((provider) => {
    const onAccountsChanged = (accounts) => {
      setAddress(accounts[0] || null);
      if (accounts[0]) localStorage.setItem(STORAGE_KEY, accounts[0]);
      else localStorage.removeItem(STORAGE_KEY);
    };
    const onChainChanged = (cid) => setChainId(parseInt(cid, 16));
    const onDisconnect = () => {
      setAddress(null);
      setProviderKind(null);
      activeProvider = null;
      localStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem(STORAGE_KIND_KEY);
    };

    provider.on?.('accountsChanged', onAccountsChanged);
    provider.on?.('chainChanged', onChainChanged);
    provider.on?.('disconnect', onDisconnect);

    return () => {
      provider.removeListener?.('accountsChanged', onAccountsChanged);
      provider.removeListener?.('chainChanged', onChainChanged);
      provider.removeListener?.('disconnect', onDisconnect);
    };
  }, []);

  // On mount: detect an injected provider, and silently reconnect if we
  // have a previously-connected address saved (works for both kinds —
  // eth_accounts for injected returns [] instead of prompting if not
  // authorized, and WalletConnect's own session persistence handles itself).
  useEffect(() => {
    if (typeof window === 'undefined') return;

    if (window.ethereum) {
      setHasProvider(true);
      window.ethereum.request({ method: 'eth_chainId' }).then((cid) => setChainId(parseInt(cid, 16))).catch(() => {});
    }

    const savedKind = localStorage.getItem(STORAGE_KIND_KEY);
    const savedAddress = localStorage.getItem(STORAGE_KEY);
    if (!savedAddress) return;

    if (savedKind === 'injected' && window.ethereum) {
      window.ethereum.request({ method: 'eth_accounts' }).then((accounts) => {
        if (accounts[0]?.toLowerCase() === savedAddress.toLowerCase()) {
          activeProvider = window.ethereum;
          setAddress(accounts[0]);
          setProviderKind('injected');
          cleanupRef.current = attachInjectedListeners(window.ethereum);
        }
      }).catch(() => {});
    } else if (savedKind === 'walletconnect') {
      getWalletConnectProvider()
        .then((provider) => {
          if (provider.accounts?.[0]) {
            activeProvider = provider;
            setAddress(provider.accounts[0]);
            setChainId(provider.chainId);
            setProviderKind('walletconnect');
            cleanupRef.current = attachInjectedListeners(provider);
          }
        })
        .catch(() => {}); // no saved WC session, or WC not configured — silent
    }

    return () => cleanupRef.current?.();
  }, [attachInjectedListeners]);

  const connectInjected = useCallback(async () => {
    setConnecting(true);
    try {
      const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
      activeProvider = window.ethereum;
      setAddress(accounts[0]);
      setProviderKind('injected');
      localStorage.setItem(STORAGE_KEY, accounts[0]);
      localStorage.setItem(STORAGE_KIND_KEY, 'injected');
      const cid = await window.ethereum.request({ method: 'eth_chainId' });
      setChainId(parseInt(cid, 16));
      cleanupRef.current?.();
      cleanupRef.current = attachInjectedListeners(window.ethereum);
    } catch (err) {
      console.error('[wallet] injected connect failed:', err.message);
    } finally {
      setConnecting(false);
    }
  }, [attachInjectedListeners]);

  const connectWalletConnect = useCallback(async () => {
    setConnecting(true);
    try {
      const provider = await getWalletConnectProvider();
      await provider.connect(); // opens QR modal (desktop) or wallet picker/deep link (mobile)
      const accounts = provider.accounts;
      if (!accounts?.[0]) throw new Error('No account returned from WalletConnect session.');
      activeProvider = provider;
      setAddress(accounts[0]);
      setChainId(provider.chainId);
      setProviderKind('walletconnect');
      localStorage.setItem(STORAGE_KEY, accounts[0]);
      localStorage.setItem(STORAGE_KIND_KEY, 'walletconnect');
      cleanupRef.current?.();
      cleanupRef.current = attachInjectedListeners(provider);
    } catch (err) {
      console.error('[wallet] WalletConnect connect failed:', err.message);
    } finally {
      setConnecting(false);
    }
  }, [attachInjectedListeners]);

  // Single entry point the UI calls. Picks the right path automatically:
  // injected if present (desktop extension / wallet in-app browser),
  // otherwise WalletConnect if configured, otherwise send the user to
  // install MetaMask as a last resort (desktop only — see WalletBar).
  const connect = useCallback(async () => {
    if (typeof window !== 'undefined' && window.ethereum) {
      return connectInjected();
    }
    if (wcSupported) {
      return connectWalletConnect();
    }
    // No injected provider and WalletConnect isn't configured — nothing we
    // can do but point desktop users at an extension to install. On mobile
    // this is a weak fallback; configuring NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID
    // is the real fix for mobile visitors.
    window.location.href = 'https://metamask.io/download/';
  }, [connectInjected, connectWalletConnect, wcSupported]);

  const disconnect = useCallback(() => {
    if (providerKind === 'walletconnect' && activeProvider?.disconnect) {
      activeProvider.disconnect().catch(() => {});
    }
    cleanupRef.current?.();
    cleanupRef.current = null;
    activeProvider = null;
    setAddress(null);
    setProviderKind(null);
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(STORAGE_KIND_KEY);
  }, [providerKind]);

  const switchToTargetChain = useCallback(async () => {
    const provider = activeProvider;
    if (!provider) return;
    try {
      await provider.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: CHAIN_HEX }],
      });
    } catch (err) {
      // 4902 = chain not added to wallet yet
      if (err.code === 4902) {
        try {
          await provider.request({
            method: 'wallet_addEthereumChain',
            params: [
              {
                chainId: CHAIN_HEX,
                chainName: process.env.NEXT_PUBLIC_CHAIN_NAME || 'BOT Chain',
                nativeCurrency: { name: 'BOT', symbol: 'BOT', decimals: 18 },
                rpcUrls: [process.env.NEXT_PUBLIC_RPC_URL || 'https://rpc.bohr.life'],
                blockExplorerUrls: [process.env.NEXT_PUBLIC_EXPLORER_URL || 'https://scan.bohr.life'],
              },
            ],
          });
        } catch (addErr) {
          console.error('[wallet] add chain failed:', addErr.message);
        }
      } else {
        console.error('[wallet] switch chain failed:', err.message);
      }
    }
  }, []);

  return {
    address,
    chainId,
    connecting,
    hasProvider, // true only for injected — UI uses this + wcSupported to decide button copy
    wcSupported,
    providerKind,
    connect,
    connectInjected,
    connectWalletConnect,
    disconnect,
    switchToTargetChain,
    wrongChain: address !== null && chainId !== null && chainId !== TARGET_CHAIN_ID,
    targetChainId: TARGET_CHAIN_ID,
  };
}
