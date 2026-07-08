'use client';

import { useCallback, useEffect, useState } from 'react';

const STORAGE_KEY = 'sg_wallet';
const TARGET_CHAIN_ID = parseInt(process.env.NEXT_PUBLIC_CHAIN_ID || '968', 10);
const CHAIN_HEX = '0x' + TARGET_CHAIN_ID.toString(16);

// Standalone helper (not part of useWallet) — sends one raw transaction via
// the injected EIP-1193 provider. Used after the Intent Router returns a
// ready-to-sign { to, data, value } so the connected wallet can actually
// sign and broadcast it, closing the loop from intent -> verdict -> tx.
export async function sendRawTransaction({ from, to, data, value }) {
  if (typeof window === 'undefined' || !window.ethereum) {
    throw new Error('No wallet provider found (window.ethereum missing).');
  }
  if (!from || !to) throw new Error('from and to are required to send a transaction.');

  // eth_sendTransaction wants value as a 0x-prefixed hex string, but
  // /api/intent/build returns it as a decimal string (e.g. "0").
  const hexValue = '0x' + BigInt(value || '0').toString(16);

  const txHash = await window.ethereum.request({
    method: 'eth_sendTransaction',
    params: [{ from, to, data: data || '0x', value: hexValue }],
  });

  return txHash;
}

// Raw EIP-1193 wallet connection — deliberately no wagmi/ethers dependency
// on the frontend. All we need is an address, a chain id, and the ability
// to send one raw transaction for the private-tier payment.
export function useWallet() {
  const [address, setAddress] = useState(null);
  const [chainId, setChainId] = useState(null);
  const [connecting, setConnecting] = useState(false);
  const [hasProvider, setHasProvider] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.ethereum) return;
    setHasProvider(true);

    window.ethereum.request({ method: 'eth_chainId' }).then((cid) => setChainId(parseInt(cid, 16)));

    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      window.ethereum.request({ method: 'eth_accounts' }).then((accounts) => {
        if (accounts[0]?.toLowerCase() === saved.toLowerCase()) setAddress(accounts[0]);
      });
    }

    const onAccountsChanged = (accounts) => {
      setAddress(accounts[0] || null);
      if (accounts[0]) localStorage.setItem(STORAGE_KEY, accounts[0]);
      else localStorage.removeItem(STORAGE_KEY);
    };
    const onChainChanged = (cid) => setChainId(parseInt(cid, 16));

    window.ethereum.on?.('accountsChanged', onAccountsChanged);
    window.ethereum.on?.('chainChanged', onChainChanged);
    return () => {
      window.ethereum.removeListener?.('accountsChanged', onAccountsChanged);
      window.ethereum.removeListener?.('chainChanged', onChainChanged);
    };
  }, []);

  const connect = useCallback(async () => {
    if (!window.ethereum) {
      window.open('https://metamask.io/download/', '_blank');
      return;
    }
    setConnecting(true);
    try {
      const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
      setAddress(accounts[0]);
      localStorage.setItem(STORAGE_KEY, accounts[0]);
      const cid = await window.ethereum.request({ method: 'eth_chainId' });
      setChainId(parseInt(cid, 16));
    } catch (err) {
      console.error('[wallet] connect failed:', err.message);
    } finally {
      setConnecting(false);
    }
  }, []);

  const disconnect = useCallback(() => {
    setAddress(null);
    localStorage.removeItem(STORAGE_KEY);
  }, []);

  const switchToTargetChain = useCallback(async () => {
    if (!window.ethereum) return;
    try {
      await window.ethereum.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: CHAIN_HEX }],
      });
    } catch (err) {
      // 4902 = chain not added to wallet yet
      if (err.code === 4902) {
        try {
          await window.ethereum.request({
            method: 'wallet_addEthereumChain',
            params: [
              {
                chainId: CHAIN_HEX,
                chainName: process.env.NEXT_PUBLIC_CHAIN_NAME || 'BOT Chain Testnet',
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
    hasProvider,
    connect,
    disconnect,
    switchToTargetChain,
    wrongChain: address !== null && chainId !== null && chainId !== TARGET_CHAIN_ID,
    targetChainId: TARGET_CHAIN_ID,
  };
}
