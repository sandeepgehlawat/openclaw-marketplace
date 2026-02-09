import { PublicKey, Keypair, Transaction } from "@solana/web3.js";
import { getConnection, loadWallet } from "../solana/client.js";
import { verifyUsdcTransfer } from "../solana/usdc.js";
import { PLATFORM_WALLET, PLATFORM_FEE_PERCENT, calculateFees, USDC_MINT_DEVNET } from "../config/constants.js";
import { createTransferInstruction, getAssociatedTokenAddress, createAssociatedTokenAccountInstruction, getAccount } from "@solana/spl-token";
import { query, queryOne } from "../db/index.js";

const ESCROW_WALLET = process.env.ESCROW_WALLET || PLATFORM_WALLET;
const ESCROW_PRIVATE_KEY = process.env.ESCROW_PRIVATE_KEY;

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

function rowToEscrow(row: any): EscrowRecord {
  return {
    jobId: row.job_id,
    requesterWallet: row.requester_wallet,
    workerWallet: row.worker_wallet,
    amountAtomic: BigInt(row.amount_atomic),
    depositTxSig: row.deposit_tx_sig,
    depositVerifiedAt: new Date(row.deposit_verified_at),
    status: row.status,
    releaseTxSig: row.release_tx_sig,
    releasedAt: row.released_at ? new Date(row.released_at) : null,
  };
}

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

  getEscrowWallet(): string {
    return ESCROW_WALLET;
  }

  isOperational(): boolean {
    return !!this.escrowKeypair;
  }

  async verifyDeposit(
    jobId: string,
    requesterWallet: string,
    expectedAmountAtomic: bigint,
    depositTxSig: string
  ): Promise<{ success: boolean; error?: string }> {
    // Check if deposit tx already used
    const usedTx = await queryOne(
      `SELECT tx_sig FROM used_deposit_txs WHERE tx_sig = $1`,
      [depositTxSig]
    );
    if (usedTx) {
      return { success: false, error: "Deposit transaction already used" };
    }

    // Check if job already has escrow
    const existingEscrow = await queryOne(
      `SELECT job_id FROM escrow_records WHERE job_id = $1`,
      [jobId]
    );
    if (existingEscrow) {
      return { success: false, error: "Job already has escrow deposit" };
    }

    try {
      const verified = await verifyUsdcTransfer(
        depositTxSig,
        requesterWallet,
        ESCROW_WALLET,
        expectedAmountAtomic
      );

      if (!verified) {
        return { success: false, error: "Deposit not verified - check amount and recipient" };
      }

      // Create escrow record
      await query(
        `INSERT INTO escrow_records (job_id, requester_wallet, amount_atomic, deposit_tx_sig, status)
         VALUES ($1, $2, $3, $4, 'held')`,
        [jobId, requesterWallet, expectedAmountAtomic.toString(), depositTxSig]
      );

      // Mark tx as used
      await query(
        `INSERT INTO used_deposit_txs (tx_sig) VALUES ($1)`,
        [depositTxSig]
      );

      console.log(`Escrow verified for job ${jobId}: ${expectedAmountAtomic} atomic units`);
      return { success: true };

    } catch (error) {
      console.error("Escrow verification error:", error);
      return { success: false, error: "Verification failed" };
    }
  }

  async releaseToWorker(
    jobId: string,
    workerWallet: string
  ): Promise<{ success: boolean; txSig?: string; error?: string }> {
    const record = await this.getEscrow(jobId);

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

      const tx = new Transaction();

      const escrowAta = await getAssociatedTokenAddress(
        USDC_MINT_DEVNET,
        this.escrowKeypair.publicKey
      );

      const workerPubkey = new PublicKey(workerWallet);
      const workerAta = await getAssociatedTokenAddress(USDC_MINT_DEVNET, workerPubkey);

      // Create worker ATA if it doesn't exist
      try {
        await getAccount(conn, workerAta);
      } catch {
        tx.add(
          createAssociatedTokenAccountInstruction(
            this.escrowKeypair.publicKey,
            workerAta,
            workerPubkey,
            USDC_MINT_DEVNET
          )
        );
      }

      tx.add(
        createTransferInstruction(
          escrowAta,
          workerAta,
          this.escrowKeypair.publicKey,
          workerAmount
        )
      );

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

      const { blockhash } = await conn.getLatestBlockhash();
      tx.recentBlockhash = blockhash;
      tx.feePayer = this.escrowKeypair.publicKey;
      tx.sign(this.escrowKeypair);

      const txSig = await conn.sendRawTransaction(tx.serialize());
      await conn.confirmTransaction(txSig, "confirmed");

      // Update record in DB
      await query(
        `UPDATE escrow_records
         SET status = 'released', worker_wallet = $1, release_tx_sig = $2, released_at = NOW()
         WHERE job_id = $3`,
        [workerWallet, txSig, jobId]
      );

      console.log(`Escrow released for job ${jobId}: ${workerAmount} to worker, ${platformFee} to platform`);
      return { success: true, txSig };

    } catch (error) {
      console.error("Escrow release error:", error);
      return { success: false, error: "Release transaction failed" };
    }
  }

  async refundToRequester(jobId: string): Promise<{ success: boolean; txSig?: string; error?: string }> {
    const record = await this.getEscrow(jobId);

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

      const escrowAta = await getAssociatedTokenAddress(
        USDC_MINT_DEVNET,
        this.escrowKeypair.publicKey
      );

      const requesterPubkey = new PublicKey(record.requesterWallet);
      const requesterAta = await getAssociatedTokenAddress(USDC_MINT_DEVNET, requesterPubkey);

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
      await query(
        `UPDATE escrow_records
         SET status = 'refunded', release_tx_sig = $1, released_at = NOW()
         WHERE job_id = $2`,
        [txSig, jobId]
      );

      console.log(`Escrow refunded for job ${jobId}: ${record.amountAtomic} to requester`);
      return { success: true, txSig };

    } catch (error) {
      console.error("Escrow refund error:", error);
      return { success: false, error: "Refund transaction failed" };
    }
  }

  async getEscrow(jobId: string): Promise<EscrowRecord | null> {
    const row = await queryOne(
      `SELECT * FROM escrow_records WHERE job_id = $1`,
      [jobId]
    );
    return row ? rowToEscrow(row) : null;
  }

  async hasVerifiedEscrow(jobId: string): Promise<boolean> {
    const record = await this.getEscrow(jobId);
    return !!record && record.status === "held";
  }

  async getAllRecords(): Promise<EscrowRecord[]> {
    const rows = await query(`SELECT * FROM escrow_records ORDER BY deposit_verified_at DESC`);
    return rows.map(rowToEscrow);
  }

  async getTotalHeld(): Promise<bigint> {
    const row = await queryOne<{ total: string }>(
      `SELECT COALESCE(SUM(amount_atomic), 0) as total FROM escrow_records WHERE status = 'held'`
    );
    return BigInt(row?.total || "0");
  }
}

export const escrowService = new EscrowService();
