import { Keypair, PublicKey, Transaction } from "@solana/web3.js";
import { getConnection, loadWallet } from "../solana/client.js";
import {
  buildUsdcTransferTx,
  transferUsdc,
  verifyUsdcTransfer,
} from "../solana/usdc.js";
import {
  USDC_MINT_DEVNET,
  SOLANA_NETWORK,
  PLATFORM_WALLET,
  PLATFORM_FEE_PERCENT,
  calculateFees,
} from "../config/constants.js";

// x402 Payment Required response format (with fee breakdown)
export interface X402PaymentRequired {
  accepts: Array<{
    scheme: "exact";
    network: string;
    maxAmountRequired: string;
    asset: string;
    payTo: string;
  }>;
  // Extended info for multi-recipient payments
  breakdown?: {
    total: string;
    worker: { address: string; amount: string };
    platform: { address: string; amount: string; percent: number };
  };
}

// x402 Payment header format
export interface X402Payment {
  serializedTransaction: string; // Base64 encoded signed transaction
}

// x402 Payment response format
export interface X402PaymentResponse {
  txSig: string;
  success: boolean;
  breakdown?: {
    workerAmount: string;
    platformFee: string;
  };
}

// Platform earnings tracking (in-memory)
const platformEarnings: Array<{
  jobId: string;
  amount: bigint;
  txSig: string;
  timestamp: Date;
}> = [];

export class PaymentService {
  // Generate 402 Payment Required response with fee breakdown
  generatePaymentRequired(
    workerWallet: string,
    totalAtomic: bigint
  ): X402PaymentRequired {
    const { workerAmount, platformFee } = calculateFees(totalAtomic);
    const hasPlatformWallet = PLATFORM_WALLET && PLATFORM_WALLET.length > 30;

    // If no platform wallet configured, all goes to worker
    if (!hasPlatformWallet) {
      return {
        accepts: [
          {
            scheme: "exact",
            network: `solana-${SOLANA_NETWORK}`,
            maxAmountRequired: totalAtomic.toString(),
            asset: USDC_MINT_DEVNET.toBase58(),
            payTo: workerWallet,
          },
        ],
      };
    }

    // With platform fee
    return {
      accepts: [
        {
          scheme: "exact",
          network: `solana-${SOLANA_NETWORK}`,
          maxAmountRequired: totalAtomic.toString(),
          asset: USDC_MINT_DEVNET.toBase58(),
          payTo: workerWallet, // Primary recipient for simple clients
        },
      ],
      breakdown: {
        total: totalAtomic.toString(),
        worker: {
          address: workerWallet,
          amount: workerAmount.toString(),
        },
        platform: {
          address: PLATFORM_WALLET,
          amount: platformFee.toString(),
          percent: PLATFORM_FEE_PERCENT,
        },
      },
    };
  }

  // Parse X-Payment header
  parsePaymentHeader(header: string): X402Payment | null {
    try {
      const decoded = Buffer.from(header, "base64").toString("utf-8");
      const parsed = JSON.parse(decoded);
      if (typeof parsed.serializedTransaction === "string") {
        return parsed as X402Payment;
      }
      return null;
    } catch {
      return null;
    }
  }

  // Verify and submit a payment transaction
  async verifyAndSubmitPayment(
    payment: X402Payment,
    workerWallet: string,
    totalAtomic: bigint,
    jobId?: string
  ): Promise<X402PaymentResponse> {
    const conn = getConnection();
    const { workerAmount, platformFee } = calculateFees(totalAtomic);
    const hasPlatformWallet = PLATFORM_WALLET && PLATFORM_WALLET.length > 30;

    try {
      // Deserialize the transaction
      const txBuffer = Buffer.from(payment.serializedTransaction, "base64");
      const tx = Transaction.from(txBuffer);

      // Submit the transaction
      const txSig = await conn.sendRawTransaction(txBuffer, {
        skipPreflight: false,
        preflightCommitment: "confirmed",
      });

      // Wait for confirmation
      await conn.confirmTransaction(txSig, "confirmed");

      // Verify the worker received payment
      // For now, accept either full amount OR worker amount (for split payments)
      const minAcceptable = hasPlatformWallet ? workerAmount : totalAtomic;

      const verified = await verifyUsdcTransfer(
        txSig,
        "",
        workerWallet,
        minAcceptable
      );

      if (!verified) {
        return { txSig, success: false };
      }

      // Track platform earnings if platform wallet is configured
      if (hasPlatformWallet && platformFee > 0n && jobId) {
        // Check if platform also received its share
        const platformReceived = await verifyUsdcTransfer(
          txSig,
          "",
          PLATFORM_WALLET,
          platformFee
        );

        if (platformReceived) {
          platformEarnings.push({
            jobId,
            amount: platformFee,
            txSig,
            timestamp: new Date(),
          });
          console.log(`Platform earned ${platformFee} atomic units from job ${jobId}`);
        }
      }

      return {
        txSig,
        success: true,
        breakdown: {
          workerAmount: workerAmount.toString(),
          platformFee: platformFee.toString(),
        },
      };
    } catch (error) {
      console.error("Payment verification failed:", error);
      throw error;
    }
  }

  // Build a payment transaction for a client (with optional platform fee)
  async buildPaymentTx(
    senderPubkey: string,
    recipientWallet: string,
    amountAtomic: bigint
  ): Promise<string> {
    const sender = new PublicKey(senderPubkey);
    const tx = await buildUsdcTransferTx(sender, recipientWallet, amountAtomic);

    // Serialize (unsigned)
    const serialized = tx.serialize({
      requireAllSignatures: false,
      verifySignatures: false,
    });

    return serialized.toString("base64");
  }

  // Helper to encode payment response
  encodePaymentRequired(paymentReq: X402PaymentRequired): string {
    return Buffer.from(JSON.stringify(paymentReq)).toString("base64");
  }

  encodePaymentResponse(response: X402PaymentResponse): string {
    return Buffer.from(JSON.stringify(response)).toString("base64");
  }

  // Get platform earnings summary
  getPlatformEarnings(): {
    total: bigint;
    count: number;
    transactions: typeof platformEarnings;
  } {
    const total = platformEarnings.reduce((sum, e) => sum + e.amount, 0n);
    return {
      total,
      count: platformEarnings.length,
      transactions: platformEarnings,
    };
  }

  // Get fee info
  getFeeInfo(): { percent: number; wallet: string | null } {
    return {
      percent: PLATFORM_FEE_PERCENT,
      wallet: PLATFORM_WALLET || null,
    };
  }
}

// Singleton instance
export const paymentService = new PaymentService();
