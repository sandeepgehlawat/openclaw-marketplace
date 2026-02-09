import {
  createJob,
  getJob,
  listJobs,
  claimJob,
  completeJob,
  getResult,
  markJobPaid,
  serializeJob,
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

  serialize(job: Job): object {
    return serializeJob(job);
  }

  serializeMany(jobs: Job[]): object[] {
    return jobs.map(serializeJob);
  }
}

// Singleton instance
export const jobService = new JobService();
