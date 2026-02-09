import { PublicKey } from "@solana/web3.js";

// Solana Network
export const SOLANA_DEVNET_RPC = process.env.SOLANA_RPC_URL || "https://api.devnet.solana.com";
export const SOLANA_NETWORK = process.env.SOLANA_NETWORK || "devnet";

// USDC on Devnet (Circle's test token)
export const USDC_MINT_DEVNET = new PublicKey(
  process.env.USDC_MINT || "Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr"
);

// USDC has 6 decimals
export const USDC_DECIMALS = 6;

// Helper to convert USDC amount to atomic units
export function usdcToAtomic(amount: number): bigint {
  return BigInt(Math.round(amount * 10 ** USDC_DECIMALS));
}

// Helper to convert atomic units to USDC
export function atomicToUsdc(atomic: bigint): number {
  return Number(atomic) / 10 ** USDC_DECIMALS;
}

// Server config
export const PORT = parseInt(process.env.PORT || "3000", 10);
export const HOST = process.env.HOST || "0.0.0.0";

// Job status
export enum JobStatus {
  OPEN = "open",
  CLAIMED = "claimed",
  COMPLETED = "completed",
  PAID = "paid",
}

// WebSocket event types
export enum WsEventType {
  JOB_NEW = "job.new",
  JOB_CLAIMED = "job.claimed",
  JOB_COMPLETED = "job.completed",
  JOB_PAID = "job.paid",
}
