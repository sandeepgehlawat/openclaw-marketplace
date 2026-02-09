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
  async create(input: CreateJobInput): Promise<Job> {
    if (!isValidPublicKey(input.requesterWallet)) {
      throw new Error("Invalid requester wallet address");
    }
    return createJob(input);
  }

  async get(id: string): Promise<Job | null> {
    return getJob(id);
  }

  async list(status?: JobStatus): Promise<Job[]> {
    return listJobs(status);
  }

  async listOpen(): Promise<Job[]> {
    return listJobs(JobStatus.OPEN);
  }

  async claim(id: string, workerWallet: string): Promise<Job | null> {
    if (!isValidPublicKey(workerWallet)) {
      throw new Error("Invalid worker wallet address");
    }

    const job = await getJob(id);
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

  async complete(id: string, result: string, workerWallet: string): Promise<Job | null> {
    if (!isValidPublicKey(workerWallet)) {
      throw new Error("Invalid worker wallet address");
    }

    const job = await getJob(id);
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

  async getResult(jobId: string): Promise<JobResult | null> {
    return getResult(jobId);
  }

  async markPaid(id: string, txSig: string): Promise<Job | null> {
    return markJobPaid(id, txSig);
  }

  async activate(id: string, depositTxSig: string): Promise<Job | null> {
    const job = await getJob(id);
    if (!job) {
      throw new Error("Job not found");
    }
    if (job.status !== JobStatus.PENDING_DEPOSIT) {
      throw new Error("Job not pending deposit");
    }
    return activateJob(id, depositTxSig);
  }

  async cancel(id: string, requesterWallet: string): Promise<Job | null> {
    if (!isValidPublicKey(requesterWallet)) {
      throw new Error("Invalid wallet address");
    }
    const job = await getJob(id);
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

  async expire(id: string): Promise<Job | null> {
    return expireJob(id);
  }

  async markEscrowReleased(id: string, releaseTxSig: string): Promise<Job | null> {
    return markEscrowReleased(id, releaseTxSig);
  }

  async listPendingDeposit(requesterWallet: string): Promise<Job[]> {
    const jobs = await listJobs(JobStatus.PENDING_DEPOSIT);
    return jobs.filter(j => j.requesterWallet === requesterWallet);
  }

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

export const jobService = new JobService();
