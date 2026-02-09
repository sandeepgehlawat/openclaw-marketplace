import { Router, Request, Response, NextFunction } from "express";
import { paymentService } from "../../services/payment-service.js";
import { jobService } from "../../services/job-service.js";
import { atomicToUsdc, PLATFORM_FEE_PERCENT, PLATFORM_WALLET, JobStatus } from "../../config/constants.js";

const router = Router();

// Admin API key from environment - REQUIRED for security
const ADMIN_API_KEY = process.env.ADMIN_API_KEY;

// Authentication middleware for admin routes
function requireAdminAuth(req: Request, res: Response, next: NextFunction) {
  // If no admin key is configured, disable admin endpoints entirely
  if (!ADMIN_API_KEY) {
    console.warn("ADMIN_API_KEY not configured - admin endpoints disabled");
    return res.status(503).json({
      error: "Admin endpoints disabled",
      message: "ADMIN_API_KEY environment variable not configured"
    });
  }

  const apiKey = req.headers["x-admin-key"] || req.headers["authorization"]?.replace("Bearer ", "");

  if (!apiKey) {
    return res.status(401).json({
      error: "Authentication required",
      message: "Provide admin API key via X-Admin-Key header or Authorization: Bearer <key>"
    });
  }

  if (apiKey !== ADMIN_API_KEY) {
    console.warn(`Invalid admin API key attempt from ${req.ip}`);
    return res.status(403).json({ error: "Invalid API key" });
  }

  next();
}

// Apply auth to all admin routes
router.use(requireAdminAuth);

// GET /api/v1/admin/stats - Platform statistics
router.get("/stats", async (req: Request, res: Response) => {
  try {
    const jobs = jobService.list();
    const earnings = paymentService.getPlatformEarnings();
    const feeInfo = paymentService.getFeeInfo();

    // Calculate stats
    const totalJobs = jobs.length;
    const paidJobs = jobs.filter((j) => j.status === "paid").length;
    const totalVolume = jobs
      .filter((j) => j.status === "paid")
      .reduce((sum, j) => sum + j.bountyAtomic, 0n);

    res.json({
      success: true,
      platform: {
        feePercent: feeInfo.percent,
        wallet: feeInfo.wallet ? `${feeInfo.wallet.slice(0, 8)}...` : "Not configured",
        walletFull: feeInfo.wallet || null,
      },
      stats: {
        totalJobs,
        paidJobs,
        openJobs: jobs.filter((j) => j.status === "open").length,
        claimedJobs: jobs.filter((j) => j.status === "claimed").length,
        completedJobs: jobs.filter((j) => j.status === "completed").length,
      },
      volume: {
        totalAtomic: totalVolume.toString(),
        totalUsdc: atomicToUsdc(totalVolume),
      },
      earnings: {
        totalAtomic: earnings.total.toString(),
        totalUsdc: atomicToUsdc(earnings.total),
        transactionCount: earnings.count,
      },
    });
  } catch (error) {
    console.error("Error fetching stats:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/v1/admin/earnings - Detailed earnings
router.get("/earnings", async (req: Request, res: Response) => {
  try {
    const earnings = paymentService.getPlatformEarnings();

    res.json({
      success: true,
      total: {
        atomic: earnings.total.toString(),
        usdc: atomicToUsdc(earnings.total),
      },
      count: earnings.count,
      transactions: earnings.transactions.map((t) => ({
        jobId: t.jobId,
        amount: atomicToUsdc(t.amount),
        amountAtomic: t.amount.toString(),
        txSig: t.txSig,
        timestamp: t.timestamp,
        explorer: `https://explorer.solana.com/tx/${t.txSig}?cluster=devnet`,
      })),
    });
  } catch (error) {
    console.error("Error fetching earnings:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/v1/admin/fee-info - Current fee configuration
router.get("/fee-info", async (req: Request, res: Response) => {
  const feeInfo = paymentService.getFeeInfo();

  res.json({
    success: true,
    feePercent: feeInfo.percent,
    platformWallet: feeInfo.wallet,
    example: {
      bounty: 1.0,
      workerReceives: (1.0 * (100 - feeInfo.percent)) / 100,
      platformReceives: (1.0 * feeInfo.percent) / 100,
    },
  });
});

// GET /api/v1/admin/results - View all completed job results (admin only)
router.get("/results", async (req: Request, res: Response) => {
  try {
    const jobs = jobService.list();
    const completedJobs = jobs.filter(
      (j) => j.status === JobStatus.COMPLETED || j.status === JobStatus.PAID
    );

    const results = completedJobs.map((job) => {
      const result = jobService.getResult(job.id);
      return {
        jobId: job.id,
        title: job.title,
        status: job.status,
        bountyUsdc: job.bountyUsdc,
        worker: job.workerWallet,
        completedAt: job.completedAt,
        paidAt: job.paidAt,
        result: result?.result || null,
      };
    });

    res.json({
      success: true,
      count: results.length,
      results,
    });
  } catch (error) {
    console.error("Error fetching results:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/v1/admin/results/:jobId - View specific job result (admin only)
router.get("/results/:jobId", async (req: Request<{ jobId: string }>, res: Response) => {
  try {
    const jobId = req.params.jobId;
    const job = jobService.get(jobId);

    if (!job) {
      return res.status(404).json({ error: "Job not found" });
    }

    const result = jobService.getResult(jobId);

    res.json({
      success: true,
      job: {
        id: job.id,
        title: job.title,
        description: job.description,
        status: job.status,
        bountyUsdc: job.bountyUsdc,
        requester: job.requesterWallet,
        worker: job.workerWallet,
        createdAt: job.createdAt,
        claimedAt: job.claimedAt,
        completedAt: job.completedAt,
        paidAt: job.paidAt,
        paymentTxSig: job.paymentTxSig,
      },
      result: result?.result || null,
    });
  } catch (error) {
    console.error("Error fetching result:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/v1/admin/jobs - List all jobs with full details
router.get("/jobs", async (req: Request, res: Response) => {
  try {
    const jobs = jobService.list();

    res.json({
      success: true,
      count: jobs.length,
      jobs: jobs.map((job) => ({
        id: job.id,
        title: job.title,
        description: job.description,
        status: job.status,
        bountyUsdc: job.bountyUsdc,
        requester: job.requesterWallet,
        worker: job.workerWallet,
        tags: job.tags,
        createdAt: job.createdAt,
        claimedAt: job.claimedAt,
        completedAt: job.completedAt,
        paidAt: job.paidAt,
      })),
    });
  } catch (error) {
    console.error("Error fetching jobs:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
