import type {
  EthereumProvider,
  Hex,
  PreparedTransaction,
  PublicConfig,
} from "./types";
import { apiFetch } from "./api";

export const provider = () =>
  (window as typeof window & { ethereum?: EthereumProvider }).ethereum;

export async function connectAndAuthenticate(config: PublicConfig) {
  const walletProvider = provider();
  if (!walletProvider) throw new Error("WALLET_PROVIDER_REQUIRED");
  const accounts = await walletProvider.request({
    method: "eth_requestAccounts",
  }) as string[];
  const address = accounts[0] as Hex | undefined;
  if (!address) throw new Error("WALLET_ACCOUNT_REQUIRED");
  let chainHex = await walletProvider.request({ method: "eth_chainId" }) as string;
  if (Number.parseInt(chainHex, 16) !== config.chainId) {
    await walletProvider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: `0x${config.chainId.toString(16)}` }],
    });
    chainHex = await walletProvider.request({ method: "eth_chainId" }) as string;
  }
  if (Number.parseInt(chainHex, 16) !== config.chainId) {
    throw new Error("CHAIN_ID_MISMATCH");
  }
  const { nonce } = await apiFetch<{ nonce: string }>("/auth/siwe/nonce", {
    method: "POST",
  });
  const issuedAt = new Date().toISOString();
  const expiration = new Date(Date.now() + 10 * 60_000).toISOString();
  const domain = config.siweDomain ?? "eventclear.local";
  const uri = config.siweUri ?? "http://eventclear.local";
  const message = `${domain} wants you to sign in with your Ethereum account:
${address}

Sign in to EventClear.

URI: ${uri}
Version: 1
Chain ID: ${config.chainId}
Nonce: ${nonce}
Issued At: ${issuedAt}
Expiration Time: ${expiration}`;
  const signature = await walletProvider.request({
    method: "personal_sign",
    params: [message, address],
  }) as Hex;
  const verified = await apiFetch<{
    sessionToken: string;
    address: Hex;
  }>("/auth/siwe/verify", {
    method: "POST",
    body: JSON.stringify({ nonce, message, signature }),
  });
  localStorage.setItem("eventclear.session", verified.sessionToken);
  localStorage.setItem("eventclear.wallet", verified.address);
  return {
    address: verified.address,
    session: verified.sessionToken,
    chainId: config.chainId,
  };
}

export function verifyPreparedTransaction(
  prepared: PreparedTransaction,
  config: PublicConfig,
) {
  const allowed = new Set([
    config.vaultAddress.toLowerCase(),
    config.fundingPoolAddress.toLowerCase(),
    config.conditionalTokensAddress.toLowerCase(),
  ]);
  if (prepared.chainId !== config.chainId) throw new Error("PREPARED_CHAIN_MISMATCH");
  if (!allowed.has(prepared.transactionRequest.to.toLowerCase())) {
    throw new Error("PREPARED_DESTINATION_MISMATCH");
  }
  if (
    prepared.transactionRequest.data.slice(0, 10).toLowerCase()
    !== prepared.expectedSelector.toLowerCase()
  ) {
    throw new Error("PREPARED_SELECTOR_MISMATCH");
  }
  if (prepared.transactionRequest.value !== "0x0") {
    throw new Error("PREPARED_VALUE_NONZERO");
  }
}

export async function submitAndWait(
  from: Hex,
  prepared: PreparedTransaction,
  config: PublicConfig,
) {
  verifyPreparedTransaction(prepared, config);
  const walletProvider = provider();
  if (!walletProvider) throw new Error("WALLET_PROVIDER_REQUIRED");
  const hash = await walletProvider.request({
    method: "eth_sendTransaction",
    params: [{ from, ...prepared.transactionRequest }],
  }) as Hex;
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const receipt = await walletProvider.request({
      method: "eth_getTransactionReceipt",
      params: [hash],
    }) as { status?: string } | null;
    if (receipt) {
      if (receipt.status !== "0x1") throw new Error("TRANSACTION_REVERTED");
      return hash;
    }
    await new Promise((resolve) => window.setTimeout(resolve, 1_000));
  }
  throw new Error("TRANSACTION_RECEIPT_TIMEOUT");
}
