import { Router, Request, Response } from "express";
import { jobService } from "../../services/job-service.js";
import { x402Paywall } from "../middleware/x402.js";
import { wsHub } from "../websocket/hub.js";

const router = Router();

// GET /api/v1/results/:jobId - Get job result (x402 paywalled)
router.get("/:jobId", x402Paywall(), async (req: Request<{ jobId: string }>, res: Response) => {
  try {
    const jobId = req.params.jobId;
    const result = jobService.getResult(jobId);
    const job = jobService.get(jobId);

    if (!result || !job) {
      return res.status(404).json({ error: "Result not found" });
    }

    // If payment was just processed, broadcast
    if (req.payment?.verified) {
      wsHub.broadcastJobPaid(job);
    }

    res.json({
      success: true,
      jobId: result.jobId,
      result: result.result,
      worker: result.workerWallet,
      submittedAt: result.submittedAt,
      payment: req.payment
        ? {
            txSig: req.payment.txSig,
            verified: req.payment.verified,
          }
        : {
            status: "already_paid",
            txSig: job.paymentTxSig,
          },
    });
  } catch (error) {
    console.error("Error fetching result:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
