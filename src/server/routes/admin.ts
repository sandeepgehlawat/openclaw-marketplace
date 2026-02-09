import { Router, Request, Response, NextFunction } from "express";
import { paymentService } from "../../services/payment-service.js";
import { jobService } from "../../services/job-service.js";
import { escrowService } from "../../services/escrow-service.js";
import { atomicToUsdc, JobStatus } from "../../config/constants.js";

const router = Router();

const ADMIN_API_KEY = process.env.ADMIN_API_KEY;
const ADMIN_ALLOWED_IPS = process.env.ADMIN_ALLOWED_IPS?.split(",").map(ip => ip.trim()).filter(Boolean) || [];

function isAllowedIP(ip: string | undefined): boolean {
  if (!ip) return false;
  const localhostIPs = ["127.0.0.1", "::1", "::ffff:127.0.0.1", "localhost"];
  if (localhostIPs.includes(ip)) return true;
  if (ADMIN_ALLOWED_IPS.includes(ip)) return true;
  return false;
}

function requireAdminAuth(req: Request, res: Response, next: NextFunction) {
  const clientIP = req.ip || req.socket.remoteAddress;

  if (!ADMIN_API_KEY) {
    return res.status(503).json({ error: "Admin disabled" });
  }

  if (!isAllowedIP(clientIP)) {
    console.warn(`Admin blocked: unauthorized IP ${clientIP}`);
    return res.status(403).json({ error: "Access denied" });
  }

  const apiKey = req.headers["x-admin-key"] || req.headers["authorization"]?.replace("Bearer ", "");

  if (!apiKey || apiKey !== ADMIN_API_KEY) {
    console.warn(`Admin blocked: invalid key from ${clientIP}`);
    return res.status(403).json({ error: "Access denied" });
  }

  next();
}

router.use(requireAdminAuth);

// GET /api/v1/admin/stats
router.get("/stats", async (req: Request, res: Response) => {
  try {
    const jobs = await jobService.list();
    const earnings = paymentService.getPlatformEarnings();
    const feeInfo = paymentService.getFeeInfo();

    const totalJobs = jobs.length;
    const paidJobs = jobs.filter((j) => j.status === "paid").length;
    const totalVolume = jobs
      .filter((j) => j.status === "paid")
      .reduce((sum, j) => sum + j.bountyAtomic, 0n);

    res.json({
      success: true,
      platform: {
        feePercent: feeInfo.percent,
        walletConfigured: !!feeInfo.wallet,
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

// GET /api/v1/admin/earnings
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

// GET /api/v1/admin/fee-info
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

// GET /api/v1/admin/results
router.get("/results", async (req: Request, res: Response) => {
  try {
    const jobs = await jobService.list();
    const completedJobs = jobs.filter(
      (j) => j.status === JobStatus.COMPLETED || j.status === JobStatus.PAID
    );

    const results = await Promise.all(completedJobs.map(async (job) => {
      const result = await jobService.getResult(job.id);
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
    }));

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

// GET /api/v1/admin/results/:jobId
router.get("/results/:jobId", async (req: Request<{ jobId: string }>, res: Response) => {
  try {
    const jobId = req.params.jobId;
    const job = await jobService.get(jobId);

    if (!job) {
      return res.status(404).json({ error: "Job not found" });
    }

    const result = await jobService.getResult(jobId);

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

// GET /api/v1/admin/jobs
router.get("/jobs", async (req: Request, res: Response) => {
  try {
    const jobs = await jobService.list();

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

// GET /api/v1/admin/escrow
router.get("/escrow", async (req: Request, res: Response) => {
  try {
    const records = await escrowService.getAllRecords();
    const totalHeld = await escrowService.getTotalHeld();

    res.json({
      success: true,
      escrow: {
        walletConfigured: !!escrowService.getEscrowWallet(),
        operational: escrowService.isOperational(),
        totalHeld: atomicToUsdc(totalHeld),
        totalHeldAtomic: totalHeld.toString(),
      },
      records: records.map(r => ({
        jobId: r.jobId,
        amountUsdc: atomicToUsdc(r.amountAtomic),
        status: r.status,
        depositVerifiedAt: r.depositVerifiedAt,
        releasedAt: r.releasedAt,
      })),
    });
  } catch (error) {
    console.error("Error fetching escrow:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
