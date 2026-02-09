import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import bs58 from "bs58";
import { SOLANA_DEVNET_RPC } from "../config/constants.js";

// Singleton connection
let connection: Connection | null = null;

export function getConnection(): Connection {
  if (!connection) {
    connection = new Connection(SOLANA_DEVNET_RPC, {
      commitment: "confirmed",
    });
  }
  return connection;
}

// Create a new random keypair
export function createWallet(): Keypair {
  return Keypair.generate();
}

// Load keypair from base58 secret key
export function loadWallet(secretKeyBase58: string): Keypair {
  const secretKey = bs58.decode(secretKeyBase58);
  return Keypair.fromSecretKey(secretKey);
}

// Export keypair to base58
export function exportWallet(keypair: Keypair): string {
  return bs58.encode(keypair.secretKey);
}

// Validate a public key string
export function isValidPublicKey(address: string): boolean {
  try {
    new PublicKey(address);
    return true;
  } catch {
    return false;
  }
}

// Get SOL balance
export async function getSolBalance(address: string): Promise<number> {
  const conn = getConnection();
  const pubkey = new PublicKey(address);
  const balance = await conn.getBalance(pubkey);
  return balance / 1e9; // Convert lamports to SOL
}

// Request SOL airdrop (devnet only)
export async function requestSolAirdrop(
  address: string,
  amountSol: number = 1
): Promise<string> {
  const conn = getConnection();
  const pubkey = new PublicKey(address);
  const signature = await conn.requestAirdrop(pubkey, amountSol * 1e9);
  await conn.confirmTransaction(signature, "confirmed");
  return signature;
}
