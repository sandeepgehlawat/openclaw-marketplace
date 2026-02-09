import { z } from "zod";
import { v4 as uuidv4 } from "uuid";
import { JobStatus } from "../config/constants.js";
import { query, queryOne } from "../db/index.js";

// Job schema for validation
export const CreateJobSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().min(1).max(5000),
  bountyUsdc: z.number().positive().max(1000),
  requesterWallet: z.string().min(32).max(44),
  tags: z.array(z.string()).optional().default([]),
});

export const ClaimJobSchema = z.object({
  workerWallet: z.string().min(32).max(44),
});

export const CompleteJobSchema = z.object({
  result: z.string().min(1).max(100000),
  workerWallet: z.string().min(32).max(44),
});

export type CreateJobInput = z.infer<typeof CreateJobSchema>;
export type ClaimJobInput = z.infer<typeof ClaimJobSchema>;
export type CompleteJobInput = z.infer<typeof CompleteJobSchema>;

// Job model
export interface Job {
  id: string;
  title: string;
  description: string;
  bountyUsdc: number;
  bountyAtomic: bigint;
  requesterWallet: string;
  workerWallet: string | null;
  status: JobStatus;
  tags: string[];
  createdAt: Date;
  claimedAt: Date | null;
  completedAt: Date | null;
  paidAt: Date | null;
  paymentTxSig: string | null;
  escrowDepositTx: string | null;
  escrowVerifiedAt: Date | null;
  escrowReleaseTx: string | null;
  expiresAt: Date | null;
}

export interface JobResult {
  jobId: string;
  result: string;
  workerWallet: string;
  submittedAt: Date;
}

// Convert DB row to Job object
function rowToJob(row: any): Job {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    bountyUsdc: parseFloat(row.bounty_usdc),
    bountyAtomic: BigInt(row.bounty_atomic),
    requesterWallet: row.requester_wallet,
    workerWallet: row.worker_wallet,
    status: row.status as JobStatus,
    tags: [], // Tags not stored in DB for simplicity
    createdAt: new Date(row.created_at),
    claimedAt: row.claimed_at ? new Date(row.claimed_at) : null,
    completedAt: row.completed_at ? new Date(row.completed_at) : null,
    paidAt: row.paid_at ? new Date(row.paid_at) : null,
    paymentTxSig: row.payment_tx_sig,
    escrowDepositTx: row.deposit_tx_sig,
    escrowVerifiedAt: row.deposit_tx_sig ? new Date(row.created_at) : null,
    escrowReleaseTx: row.payment_tx_sig,
    expiresAt: null,
  };
}

// CRUD operations (async for PostgreSQL)
export async function createJob(input: CreateJobInput): Promise<Job> {
  const id = `job_${uuidv4().slice(0, 8)}`;
  const bountyAtomic = BigInt(Math.round(input.bountyUsdc * 1e6));

  const rows = await query<any>(
    `INSERT INTO jobs (id, title, description, bounty_usdc, bounty_atomic, requester_wallet, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [id, input.title, input.description, input.bountyUsdc, bountyAtomic.toString(), input.requesterWallet, JobStatus.PENDING_DEPOSIT]
  );

  return rowToJob(rows[0]);
}

export async function activateJob(id: string, depositTxSig: string): Promise<Job | null> {
  const rows = await query<any>(
    `UPDATE jobs
     SET status = $1, deposit_tx_sig = $2
     WHERE id = $3 AND status = $4
     RETURNING *`,
    [JobStatus.OPEN, depositTxSig, id, JobStatus.PENDING_DEPOSIT]
  );

  return rows[0] ? rowToJob(rows[0]) : null;
}

export async function cancelJob(id: string, requesterWallet: string): Promise<Job | null> {
  const rows = await query<any>(
    `UPDATE jobs
     SET status = $1
     WHERE id = $2 AND requester_wallet = $3 AND status IN ($4, $5)
     RETURNING *`,
    [JobStatus.CANCELLED, id, requesterWallet, JobStatus.PENDING_DEPOSIT, JobStatus.OPEN]
  );

  return rows[0] ? rowToJob(rows[0]) : null;
}

export async function expireJob(id: string): Promise<Job | null> {
  const rows = await query<any>(
    `UPDATE jobs
     SET status = $1
     WHERE id = $2 AND status = $3
     RETURNING *`,
    [JobStatus.EXPIRED, id, JobStatus.OPEN]
  );

  return rows[0] ? rowToJob(rows[0]) : null;
}

export async function markEscrowReleased(id: string, releaseTxSig: string): Promise<Job | null> {
  const rows = await query<any>(
    `UPDATE jobs
     SET status = $1, payment_tx_sig = $2, paid_at = NOW()
     WHERE id = $3
     RETURNING *`,
    [JobStatus.PAID, releaseTxSig, id]
  );

  return rows[0] ? rowToJob(rows[0]) : null;
}

export async function getJob(id: string): Promise<Job | null> {
  const row = await queryOne<any>(
    `SELECT * FROM jobs WHERE id = $1`,
    [id]
  );

  return row ? rowToJob(row) : null;
}

export async function listJobs(status?: JobStatus): Promise<Job[]> {
  let rows: any[];

  if (status) {
    rows = await query<any>(
      `SELECT * FROM jobs WHERE status = $1 ORDER BY created_at DESC`,
      [status]
    );
  } else {
    rows = await query<any>(
      `SELECT * FROM jobs ORDER BY created_at DESC`
    );
  }

  return rows.map(rowToJob);
}

export async function claimJob(id: string, workerWallet: string): Promise<Job | null> {
  const rows = await query<any>(
    `UPDATE jobs
     SET worker_wallet = $1, status = $2, claimed_at = NOW()
     WHERE id = $3 AND status = $4
     RETURNING *`,
    [workerWallet, JobStatus.CLAIMED, id, JobStatus.OPEN]
  );

  return rows[0] ? rowToJob(rows[0]) : null;
}

export async function completeJob(id: string, result: string, workerWallet: string): Promise<Job | null> {
  const rows = await query<any>(
    `UPDATE jobs
     SET status = $1, result = $2, completed_at = NOW()
     WHERE id = $3 AND status = $4 AND worker_wallet = $5
     RETURNING *`,
    [JobStatus.COMPLETED, result, id, JobStatus.CLAIMED, workerWallet]
  );

  return rows[0] ? rowToJob(rows[0]) : null;
}

export async function getResult(jobId: string): Promise<JobResult | null> {
  const row = await queryOne<any>(
    `SELECT id, result, worker_wallet, completed_at FROM jobs WHERE id = $1 AND result IS NOT NULL`,
    [jobId]
  );

  if (!row || !row.result) return null;

  return {
    jobId: row.id,
    result: row.result,
    workerWallet: row.worker_wallet,
    submittedAt: new Date(row.completed_at),
  };
}

export async function markJobPaid(id: string, txSig: string): Promise<Job | null> {
  const rows = await query<any>(
    `UPDATE jobs
     SET status = $1, payment_tx_sig = $2, paid_at = NOW()
     WHERE id = $3 AND status = $4
     RETURNING *`,
    [JobStatus.PAID, txSig, id, JobStatus.COMPLETED]
  );

  return rows[0] ? rowToJob(rows[0]) : null;
}

// Serialize job for API response
export function serializeJob(job: Job): object {
  return {
    id: job.id,
    title: job.title,
    description: job.description,
    bountyUsdc: job.bountyUsdc,
    bountyAtomic: job.bountyAtomic.toString(),
    requesterWallet: job.requesterWallet,
    workerWallet: job.workerWallet,
    status: job.status,
    tags: job.tags,
    createdAt: job.createdAt,
    claimedAt: job.claimedAt,
    completedAt: job.completedAt,
    paidAt: job.paidAt,
    depositTxSig: job.escrowDepositTx,
    paymentTxSig: job.paymentTxSig,
    expiresAt: job.expiresAt,
  };
}
