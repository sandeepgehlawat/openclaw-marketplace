import { Router, Request, Response } from "express";
import { paymentService } from "../../services/payment-service.js";
import { jobService } from "../../services/job-service.js";
import { atomicToUsdc, PLATFORM_FEE_PERCENT, PLATFORM_WALLET } from "../../config/constants.js";

const router = Router();

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

export default router;
