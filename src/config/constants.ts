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

// Platform fee config
export const PLATFORM_FEE_PERCENT = parseFloat(process.env.PLATFORM_FEE_PERCENT || "5"); // 5% default
export const PLATFORM_WALLET = process.env.PLATFORM_WALLET || ""; // Your wallet to receive fees

// Calculate fee from amount
export function calculateFees(totalAtomic: bigint): { workerAmount: bigint; platformFee: bigint } {
  const feePercent = BigInt(Math.round(PLATFORM_FEE_PERCENT * 100)); // Convert to basis points
  const platformFee = (totalAtomic * feePercent) / 10000n;
  const workerAmount = totalAtomic - platformFee;
  return { workerAmount, platformFee };
}

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
