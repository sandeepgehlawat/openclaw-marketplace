import {
  createJob,
  getJob,
  listJobs,
  claimJob,
  completeJob,
  getResult,
  markJobPaid,
  serializeJob,
  activateJob,
  cancelJob,
  expireJob,
  markEscrowReleased,
  CreateJobInput,
  Job,
  JobResult,
} from "../models/job.js";
import { JobStatus } from "../config/constants.js";
import { isValidPublicKey } from "../solana/client.js";

export class JobService {
  create(input: CreateJobInput): Job {
    // Validate wallet address
    if (!isValidPublicKey(input.requesterWallet)) {
      throw new Error("Invalid requester wallet address");
    }
    return createJob(input);
  }

  get(id: string): Job | null {
    return getJob(id);
  }

  list(status?: JobStatus): Job[] {
    return listJobs(status);
  }

  listOpen(): Job[] {
    return listJobs(JobStatus.OPEN);
  }

  claim(id: string, workerWallet: string): Job | null {
    if (!isValidPublicKey(workerWallet)) {
      throw new Error("Invalid worker wallet address");
    }

    const job = getJob(id);
    if (!job) {
      throw new Error("Job not found");
    }
    if (job.status !== JobStatus.OPEN) {
      throw new Error(`Job cannot be claimed - status is ${job.status}`);
    }
    if (job.requesterWallet === workerWallet) {
      throw new Error("Cannot claim your own job");
    }

    return claimJob(id, workerWallet);
  }

  complete(id: string, result: string, workerWallet: string): Job | null {
    if (!isValidPublicKey(workerWallet)) {
      throw new Error("Invalid worker wallet address");
    }

    const job = getJob(id);
    if (!job) {
      throw new Error("Job not found");
    }
    if (job.status !== JobStatus.CLAIMED) {
      throw new Error(`Job cannot be completed - status is ${job.status}`);
    }
    if (job.workerWallet !== workerWallet) {
      throw new Error("Only the assigned worker can complete this job");
    }

    return completeJob(id, result, workerWallet);
  }

  getResult(jobId: string): JobResult | null {
    return getResult(jobId);
  }

  markPaid(id: string, txSig: string): Job | null {
    return markJobPaid(id, txSig);
  }

  // Escrow-related methods
  activate(id: string, depositTxSig: string): Job | null {
    const job = getJob(id);
    if (!job) {
      throw new Error("Job not found");
    }
    if (job.status !== JobStatus.PENDING_DEPOSIT) {
      throw new Error("Job not pending deposit");
    }
    return activateJob(id, depositTxSig);
  }

  cancel(id: string, requesterWallet: string): Job | null {
    if (!isValidPublicKey(requesterWallet)) {
      throw new Error("Invalid wallet address");
    }
    const job = getJob(id);
    if (!job) {
      throw new Error("Job not found");
    }
    if (job.requesterWallet !== requesterWallet) {
      throw new Error("Only requester can cancel");
    }
    if (job.status !== JobStatus.PENDING_DEPOSIT && job.status !== JobStatus.OPEN) {
      throw new Error("Job cannot be cancelled - already claimed or completed");
    }
    return cancelJob(id, requesterWallet);
  }

  expire(id: string): Job | null {
    return expireJob(id);
  }

  markEscrowReleased(id: string, releaseTxSig: string): Job | null {
    return markEscrowReleased(id, releaseTxSig);
  }

  // List jobs pending deposit (for requester to see their pending jobs)
  listPendingDeposit(requesterWallet: string): Job[] {
    return listJobs(JobStatus.PENDING_DEPOSIT).filter(
      j => j.requesterWallet === requesterWallet
    );
  }

  // Check if job is expired
  isExpired(job: Job): boolean {
    if (!job.expiresAt) return false;
    return new Date() > job.expiresAt;
  }

  serialize(job: Job): object {
    return serializeJob(job);
  }

  serializeMany(jobs: Job[]): object[] {
    return jobs.map(serializeJob);
  }
}

// Singleton instance
export const jobService = new JobService();
