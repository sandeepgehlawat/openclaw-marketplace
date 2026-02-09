import { z } from "zod";
import { v4 as uuidv4 } from "uuid";
import { JobStatus } from "../config/constants.js";

// Job schema for validation
export const CreateJobSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().min(1).max(5000),
  bountyUsdc: z.number().positive().max(1000), // Max 1000 USDC
  requesterWallet: z.string().min(32).max(44), // Solana pubkey
  tags: z.array(z.string()).optional().default([]),
});

export const ClaimJobSchema = z.object({
  workerWallet: z.string().min(32).max(44),
});

export const CompleteJobSchema = z.object({
  result: z.string().min(1).max(100000), // Result data
  workerWallet: z.string().min(32).max(44),
});

export type CreateJobInput = z.infer<typeof CreateJobSchema>;
export type ClaimJobInput = z.infer<typeof ClaimJobSchema>;
export type CompleteJobInput = z.infer<typeof CompleteJobSchema>;

// Job model (with escrow support)
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
  // Escrow fields
  escrowDepositTx: string | null;
  escrowVerifiedAt: Date | null;
  escrowReleaseTx: string | null;
  expiresAt: Date | null;
}

// Result model (stored separately for x402 paywall)
export interface JobResult {
  jobId: string;
  result: string;
  workerWallet: string;
  submittedAt: Date;
}

// In-memory stores
const jobs = new Map<string, Job>();
const results = new Map<string, JobResult>();

// Job expiry time (24 hours by default)
const JOB_EXPIRY_MS = 24 * 60 * 60 * 1000;

// CRUD operations
export function createJob(input: CreateJobInput): Job {
  const id = `job_${uuidv4().slice(0, 8)}`;
  const bountyAtomic = BigInt(Math.round(input.bountyUsdc * 1e6));
  const now = new Date();

  const job: Job = {
    id,
    title: input.title,
    description: input.description,
    bountyUsdc: input.bountyUsdc,
    bountyAtomic,
    requesterWallet: input.requesterWallet,
    workerWallet: null,
    status: JobStatus.PENDING_DEPOSIT, // Start in pending until escrow verified
    tags: input.tags || [],
    createdAt: now,
    claimedAt: null,
    completedAt: null,
    paidAt: null,
    paymentTxSig: null,
    // Escrow fields
    escrowDepositTx: null,
    escrowVerifiedAt: null,
    escrowReleaseTx: null,
    expiresAt: new Date(now.getTime() + JOB_EXPIRY_MS),
  };

  jobs.set(id, job);
  return job;
}

// Activate job after escrow deposit verified
export function activateJob(id: string, depositTxSig: string): Job | null {
  const job = jobs.get(id);
  if (!job || job.status !== JobStatus.PENDING_DEPOSIT) {
    return null;
  }

  job.status = JobStatus.OPEN;
  job.escrowDepositTx = depositTxSig;
  job.escrowVerifiedAt = new Date();
  // Reset expiry from activation time
  job.expiresAt = new Date(Date.now() + JOB_EXPIRY_MS);
  return job;
}

// Cancel job and mark for refund
export function cancelJob(id: string, requesterWallet: string): Job | null {
  const job = jobs.get(id);
  if (!job) return null;

  // Only requester can cancel
  if (job.requesterWallet !== requesterWallet) return null;

  // Can only cancel if pending or open (not yet claimed)
  if (job.status !== JobStatus.PENDING_DEPOSIT && job.status !== JobStatus.OPEN) {
    return null;
  }

  job.status = JobStatus.CANCELLED;
  return job;
}

// Expire job (for cleanup)
export function expireJob(id: string): Job | null {
  const job = jobs.get(id);
  if (!job) return null;

  // Can only expire open jobs that haven't been claimed
  if (job.status !== JobStatus.OPEN) return null;

  job.status = JobStatus.EXPIRED;
  return job;
}

// Mark escrow as released
export function markEscrowReleased(id: string, releaseTxSig: string): Job | null {
  const job = jobs.get(id);
  if (!job) return null;

  job.escrowReleaseTx = releaseTxSig;
  job.paidAt = new Date();
  job.status = JobStatus.PAID;
  return job;
}

export function getJob(id: string): Job | null {
  return jobs.get(id) || null;
}

export function listJobs(status?: JobStatus): Job[] {
  const all = Array.from(jobs.values());
  if (status) {
    return all.filter((j) => j.status === status);
  }
  return all.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}

export function claimJob(id: string, workerWallet: string): Job | null {
  const job = jobs.get(id);
  if (!job || job.status !== JobStatus.OPEN) {
    return null;
  }

  job.workerWallet = workerWallet;
  job.status = JobStatus.CLAIMED;
  job.claimedAt = new Date();
  return job;
}

export function completeJob(
  id: string,
  result: string,
  workerWallet: string
): Job | null {
  const job = jobs.get(id);
  if (!job || job.status !== JobStatus.CLAIMED) {
    return null;
  }
  if (job.workerWallet !== workerWallet) {
    return null;
  }

  // Store result
  const jobResult: JobResult = {
    jobId: id,
    result,
    workerWallet,
    submittedAt: new Date(),
  };
  results.set(id, jobResult);

  // Update job
  job.status = JobStatus.COMPLETED;
  job.completedAt = new Date();
  return job;
}

export function getResult(jobId: string): JobResult | null {
  return results.get(jobId) || null;
}

export function markJobPaid(id: string, txSig: string): Job | null {
  const job = jobs.get(id);
  if (!job || job.status !== JobStatus.COMPLETED) {
    return null;
  }

  job.status = JobStatus.PAID;
  job.paidAt = new Date();
  job.paymentTxSig = txSig;
  return job;
}

// Serialize job for API response (handle BigInt and dates)
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
    expiresAt: job.expiresAt,
    // Only include escrow info if relevant
    escrow: job.escrowDepositTx ? {
      depositVerified: !!job.escrowVerifiedAt,
      releaseTx: job.escrowReleaseTx,
    } : undefined,
  };
}
