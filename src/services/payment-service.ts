import { Keypair, PublicKey, Transaction } from "@solana/web3.js";
import { getConnection, loadWallet } from "../solana/client.js";
import {
  buildUsdcTransferTx,
  transferUsdc,
  verifyUsdcTransfer,
} from "../solana/usdc.js";
import { USDC_MINT_DEVNET, SOLANA_NETWORK } from "../config/constants.js";

// x402 Payment Required response format
export interface X402PaymentRequired {
  accepts: Array<{
    scheme: "exact";
    network: string;
    maxAmountRequired: string;
    asset: string;
    payTo: string;
  }>;
}

// x402 Payment header format
export interface X402Payment {
  serializedTransaction: string; // Base64 encoded signed transaction
}

// x402 Payment response format
export interface X402PaymentResponse {
  txSig: string;
  success: boolean;
}

export class PaymentService {
  // Generate 402 Payment Required response
  generatePaymentRequired(
    recipientWallet: string,
    amountAtomic: bigint
  ): X402PaymentRequired {
    return {
      accepts: [
        {
          scheme: "exact",
          network: `solana-${SOLANA_NETWORK}`,
          maxAmountRequired: amountAtomic.toString(),
          asset: USDC_MINT_DEVNET.toBase58(),
          payTo: recipientWallet,
        },
      ],
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
    expectedRecipient: string,
    expectedAmountAtomic: bigint
  ): Promise<X402PaymentResponse> {
    const conn = getConnection();

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

      // Verify the transfer was correct
      const verified = await verifyUsdcTransfer(
        txSig,
        "", // We don't need to verify sender
        expectedRecipient,
        expectedAmountAtomic
      );

      if (!verified) {
        return { txSig, success: false };
      }

      return { txSig, success: true };
    } catch (error) {
      console.error("Payment verification failed:", error);
      throw error;
    }
  }

  // Build a payment transaction for a client
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
}

// Singleton instance
export const paymentService = new PaymentService();
