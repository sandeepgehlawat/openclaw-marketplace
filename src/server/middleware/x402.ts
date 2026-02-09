import { Request, Response, NextFunction } from "express";
import { jobService } from "../../services/job-service.js";
import { paymentService } from "../../services/payment-service.js";
import { JobStatus } from "../../config/constants.js";

// Extend Express Request to include payment info
declare global {
  namespace Express {
    interface Request {
      payment?: {
        txSig: string;
        verified: boolean;
      };
    }
  }
}

// x402 middleware for paywalled endpoints
export function x402Paywall() {
  return async (req: Request<{ jobId: string }>, res: Response, next: NextFunction) => {
    const jobId = req.params.jobId;

    // Get job details
    const job = jobService.get(jobId);
    if (!job) {
      return res.status(404).json({ error: "Job not found" });
    }

    // Check if job has a result
    if (job.status !== JobStatus.COMPLETED && job.status !== JobStatus.PAID) {
      return res.status(400).json({
        error: "Job result not available",
        status: job.status,
      });
    }

    // If already paid, allow access
    if (job.status === JobStatus.PAID) {
      return next();
    }

    // Check for X-Payment header
    const paymentHeader = req.headers["x-payment"] as string | undefined;

    if (!paymentHeader) {
      // Return 402 Payment Required
      const paymentRequired = paymentService.generatePaymentRequired(
        job.workerWallet!,
        job.bountyAtomic
      );

      res.status(402);
      res.setHeader(
        "X-Payment-Required",
        paymentService.encodePaymentRequired(paymentRequired)
      );
      return res.json({
        error: "Payment required",
        message: "Include X-Payment header with signed USDC transfer",
        paymentDetails: paymentRequired,
      });
    }

    // Parse and verify payment
    const payment = paymentService.parsePaymentHeader(paymentHeader);
    if (!payment) {
      return res.status(400).json({
        error: "Invalid X-Payment header",
        message: "Header must be base64-encoded JSON with serializedTransaction",
      });
    }

    try {
      // Verify and submit the payment
      const result = await paymentService.verifyAndSubmitPayment(
        payment,
        job.workerWallet!,
        job.bountyAtomic,
        jobId // Pass jobId for earnings tracking
      );

      if (!result.success) {
        return res.status(402).json({
          error: "Payment verification failed",
          message: "Transaction did not transfer correct amount to worker",
        });
      }

      // Mark job as paid
      jobService.markPaid(jobId, result.txSig);

      // Add payment info to request
      req.payment = {
        txSig: result.txSig,
        verified: true,
      };

      // Set response header with payment confirmation
      res.setHeader(
        "X-Payment-Response",
        paymentService.encodePaymentResponse(result)
      );

      next();
    } catch (error) {
      console.error("Payment processing error:", error);
      return res.status(500).json({
        error: "Payment processing failed",
        message: error instanceof Error ? error.message : "Unknown error",
      });
    }
  };
}
