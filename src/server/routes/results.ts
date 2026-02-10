import { Router, Request, Response } from "express";
import { jobService } from "../../services/job-service.js";
import { escrowService } from "../../services/escrow-service.js";
import { JobStatus } from "../../config/constants.js";
import { wsHub } from "../websocket/hub.js";

const router = Router();

/**
 * GET /api/v1/results/:jobId - Get job result (releases escrow to worker)
 */
router.get("/:jobId", async (req: Request<{ jobId: string }>, res: Response) => {
  try {
    const jobId = req.params.jobId;
    const job = await jobService.get(jobId);

    if (!job) {
      return res.status(404).json({ error: "Job not found" });
    }

    if (job.status === JobStatus.PENDING_DEPOSIT) {
      return res.status(400).json({ error: "Job pending escrow deposit" });
    }

    if (job.status === JobStatus.OPEN) {
      return res.status(400).json({ error: "Job not yet claimed" });
    }

    if (job.status === JobStatus.CLAIMED) {
      return res.status(400).json({ error: "Job not yet completed" });
    }

    if (job.status === JobStatus.CANCELLED || job.status === JobStatus.EXPIRED) {
      return res.status(400).json({ error: "Job was cancelled or expired" });
    }

    const result = await jobService.getResult(jobId);
    if (!result) {
      return res.status(404).json({ error: "Result not found" });
    }

    // If already paid, just return the result
    if (job.status === JobStatus.PAID) {
      return res.json({
        success: true,
        jobId: result.jobId,
        result: result.result,
        worker: result.workerWallet,
        submittedAt: result.submittedAt,
        payment: {
          status: "released",
          txSig: job.escrowReleaseTx,
          releasedAt: job.paidAt,
        },
      });
    }

    // Job is completed - release escrow to worker
    if (job.status === JobStatus.COMPLETED) {
      if (!await escrowService.hasVerifiedEscrow(jobId)) {
        return res.status(500).json({ error: "Escrow record not found" });
      }

      const releaseResult = await escrowService.releaseToWorker(jobId, job.workerWallet!);

      if (!releaseResult.success) {
        console.error(`Escrow release failed for job ${jobId}:`, releaseResult.error);
        return res.status(500).json({ error: "Payment release failed", details: releaseResult.error });
      }

      await jobService.markEscrowReleased(jobId, releaseResult.txSig!);

      const updatedJob = await jobService.get(jobId);
      if (updatedJob) {
        wsHub.broadcastJobPaid(updatedJob);
      }

      return res.json({
        success: true,
        jobId: result.jobId,
        result: result.result,
        worker: result.workerWallet,
        submittedAt: result.submittedAt,
        payment: {
          status: "released",
          txSig: releaseResult.txSig,
          message: "Escrow released to worker",
        },
      });
    }

    return res.status(400).json({ error: "Invalid job status" });

  } catch (error) {
    console.error("Error fetching result:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
