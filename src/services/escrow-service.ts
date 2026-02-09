import { PublicKey, Keypair, Transaction } from "@solana/web3.js";
import { getConnection, loadWallet } from "../solana/client.js";
import { verifyUsdcTransfer, buildUsdcTransferTx, getUsdcBalance } from "../solana/usdc.js";
import { PLATFORM_WALLET, PLATFORM_FEE_PERCENT, calculateFees, USDC_MINT_DEVNET } from "../config/constants.js";
import { createTransferInstruction, getAssociatedTokenAddress } from "@solana/spl-token";

// Escrow configuration
const ESCROW_WALLET = process.env.ESCROW_WALLET || PLATFORM_WALLET;
const ESCROW_PRIVATE_KEY = process.env.ESCROW_PRIVATE_KEY; // Required for releases
const JOB_EXPIRY_HOURS = 24; // Jobs expire if not claimed within 24 hours

// Escrow record for tracking deposits
export interface EscrowRecord {
  jobId: string;
  requesterWallet: string;
  workerWallet: string | null;
  amountAtomic: bigint;
  depositTxSig: string;
  depositVerifiedAt: Date;
  status: "held" | "released" | "refunded";
  releaseTxSig: string | null;
  releasedAt: Date | null;
}

// In-memory escrow store (production: use database)
const escrowRecords = new Map<string, EscrowRecord>();
const usedDepositTxs = new Set<string>(); // Prevent deposit reuse

export class EscrowService {
  private escrowKeypair: Keypair | null = null;

  constructor() {
    if (ESCROW_PRIVATE_KEY) {
      try {
        this.escrowKeypair = loadWallet(ESCROW_PRIVATE_KEY);
        console.log("Escrow wallet loaded:", this.escrowKeypair.publicKey.toBase58());
      } catch (e) {
        console.error("Failed to load escrow wallet - releases will fail");
      }
    }
  }

  // Get escrow wallet address
  getEscrowWallet(): string {
    return ESCROW_WALLET;
  }

  // Check if escrow is operational (can release funds)
  isOperational(): boolean {
    return !!this.escrowKeypair;
  }

  /**
   * Verify a deposit transaction and create escrow record
   * SECURITY: Verifies on-chain that funds actually arrived
   */
  async verifyDeposit(
    jobId: string,
    requesterWallet: string,
    expectedAmountAtomic: bigint,
    depositTxSig: string
  ): Promise<{ success: boolean; error?: string }> {
    // Check if this deposit tx was already used
    if (usedDepositTxs.has(depositTxSig)) {
      return { success: false, error: "Deposit transaction already used" };
    }

    // Check if job already has escrow
    if (escrowRecords.has(jobId)) {
      return { success: false, error: "Job already has escrow deposit" };
    }

    try {
      // Verify the deposit on-chain
      const verified = await verifyUsdcTransfer(
        depositTxSig,
        requesterWallet, // Must be FROM the requester
        ESCROW_WALLET,   // Must be TO the escrow wallet
        expectedAmountAtomic
      );

      if (!verified) {
        return {
          success: false,
          error: "Deposit not verified - check amount and recipient"
        };
      }

      // Create escrow record
      const record: EscrowRecord = {
        jobId,
        requesterWallet,
        workerWallet: null,
        amountAtomic: expectedAmountAtomic,
        depositTxSig,
        depositVerifiedAt: new Date(),
        status: "held",
        releaseTxSig: null,
        releasedAt: null,
      };

      escrowRecords.set(jobId, record);
      usedDepositTxs.add(depositTxSig);

      console.log(`Escrow verified for job ${jobId}: ${expectedAmountAtomic} atomic units`);
      return { success: true };

    } catch (error) {
      console.error("Escrow verification error:", error);
      return { success: false, error: "Verification failed" };
    }
  }

  /**
   * Release escrow to worker after job completion
   * SECURITY: Only releases to verified worker, includes platform fee
   */
  async releaseToWorker(
    jobId: string,
    workerWallet: string
  ): Promise<{ success: boolean; txSig?: string; error?: string }> {
    const record = escrowRecords.get(jobId);

    if (!record) {
      return { success: false, error: "No escrow record found" };
    }

    if (record.status !== "held") {
      return { success: false, error: `Escrow already ${record.status}` };
    }

    if (!this.escrowKeypair) {
      return { success: false, error: "Escrow wallet not configured for releases" };
    }

    try {
      const conn = getConnection();
      const { workerAmount, platformFee } = calculateFees(record.amountAtomic);

      // Build transaction with both transfers (worker + platform fee)
      const tx = new Transaction();

      // Get escrow's ATA
      const escrowAta = await getAssociatedTokenAddress(
        USDC_MINT_DEVNET,
        this.escrowKeypair.publicKey
      );

      // Worker's ATA
      const workerPubkey = new PublicKey(workerWallet);
      const workerAta = await getAssociatedTokenAddress(USDC_MINT_DEVNET, workerPubkey);

      // Add worker transfer
      tx.add(
        createTransferInstruction(
          escrowAta,
          workerAta,
          this.escrowKeypair.publicKey,
          workerAmount
        )
      );

      // Add platform fee transfer if configured
      if (PLATFORM_WALLET && platformFee > 0n) {
        const platformPubkey = new PublicKey(PLATFORM_WALLET);
        const platformAta = await getAssociatedTokenAddress(USDC_MINT_DEVNET, platformPubkey);

        tx.add(
          createTransferInstruction(
            escrowAta,
            platformAta,
            this.escrowKeypair.publicKey,
            platformFee
          )
        );
      }

      // Sign and send
      const { blockhash } = await conn.getLatestBlockhash();
      tx.recentBlockhash = blockhash;
      tx.feePayer = this.escrowKeypair.publicKey;
      tx.sign(this.escrowKeypair);

      const txSig = await conn.sendRawTransaction(tx.serialize());
      await conn.confirmTransaction(txSig, "confirmed");

      // Update record
      record.status = "released";
      record.workerWallet = workerWallet;
      record.releaseTxSig = txSig;
      record.releasedAt = new Date();

      console.log(`Escrow released for job ${jobId}: ${workerAmount} to worker, ${platformFee} to platform`);
      return { success: true, txSig };

    } catch (error) {
      console.error("Escrow release error:", error);
      return { success: false, error: "Release transaction failed" };
    }
  }

  /**
   * Refund escrow to requester (for cancelled/expired jobs)
   * SECURITY: Only refunds to original requester wallet
   */
  async refundToRequester(
    jobId: string
  ): Promise<{ success: boolean; txSig?: string; error?: string }> {
    const record = escrowRecords.get(jobId);

    if (!record) {
      return { success: false, error: "No escrow record found" };
    }

    if (record.status !== "held") {
      return { success: false, error: `Escrow already ${record.status}` };
    }

    if (!this.escrowKeypair) {
      return { success: false, error: "Escrow wallet not configured" };
    }

    try {
      const conn = getConnection();

      // Get escrow's ATA
      const escrowAta = await getAssociatedTokenAddress(
        USDC_MINT_DEVNET,
        this.escrowKeypair.publicKey
      );

      // Requester's ATA - MUST be original requester
      const requesterPubkey = new PublicKey(record.requesterWallet);
      const requesterAta = await getAssociatedTokenAddress(USDC_MINT_DEVNET, requesterPubkey);

      // Build refund transaction (full amount, no fee on refund)
      const tx = new Transaction().add(
        createTransferInstruction(
          escrowAta,
          requesterAta,
          this.escrowKeypair.publicKey,
          record.amountAtomic
        )
      );

      const { blockhash } = await conn.getLatestBlockhash();
      tx.recentBlockhash = blockhash;
      tx.feePayer = this.escrowKeypair.publicKey;
      tx.sign(this.escrowKeypair);

      const txSig = await conn.sendRawTransaction(tx.serialize());
      await conn.confirmTransaction(txSig, "confirmed");

      // Update record
      record.status = "refunded";
      record.releaseTxSig = txSig;
      record.releasedAt = new Date();

      console.log(`Escrow refunded for job ${jobId}: ${record.amountAtomic} to requester`);
      return { success: true, txSig };

    } catch (error) {
      console.error("Escrow refund error:", error);
      return { success: false, error: "Refund transaction failed" };
    }
  }

  // Get escrow record for a job
  getEscrow(jobId: string): EscrowRecord | null {
    return escrowRecords.get(jobId) || null;
  }

  // Check if job has verified escrow
  hasVerifiedEscrow(jobId: string): boolean {
    const record = escrowRecords.get(jobId);
    return !!record && record.status === "held";
  }

  // Get escrow wallet balance
  async getEscrowBalance(): Promise<number> {
    return getUsdcBalance(ESCROW_WALLET);
  }

  // Get all escrow records (for admin)
  getAllRecords(): EscrowRecord[] {
    return Array.from(escrowRecords.values());
  }

  // Get total held in escrow
  getTotalHeld(): bigint {
    let total = 0n;
    for (const record of escrowRecords.values()) {
      if (record.status === "held") {
        total += record.amountAtomic;
      }
    }
    return total;
  }
}

// Singleton instance
export const escrowService = new EscrowService();
