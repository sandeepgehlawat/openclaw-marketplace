import { Router, Request, Response } from "express";
import { createHash } from "crypto";
import { jobService } from "../../services/job-service.js";
import { CreateJobSchema, ClaimJobSchema, CompleteJobSchema } from "../../models/job.js";
import { JobStatus } from "../../config/constants.js";
import { wsHub } from "../websocket/hub.js";
import { ZodError } from "zod";

// Helper to create result hash for verification
function hashResult(result: string): string {
  return createHash("sha256").update(result).digest("hex");
}

const router = Router();

// Valid job statuses for filtering
const VALID_STATUSES = ["open", "claimed", "completed", "paid"];

// Sanitize error messages - never expose internal details
function sanitizeError(error: unknown): string {
  if (error instanceof ZodError) {
    return "Invalid request data";
  }
  if (error instanceof Error) {
    // Only return safe, predefined messages
    const safeMessages = [
      "Job not found",
      "Job cannot be claimed",
      "Job already claimed",
      "Only assigned worker can complete",
      "Job not in claimed status",
      "Invalid wallet address",
    ];
    if (safeMessages.some(msg => error.message.includes(msg))) {
      return error.message;
    }
  }
  return "Request failed";
}

// POST /api/v1/jobs - Create a new job
router.post("/", async (req: Request, res: Response) => {
  try {
    const input = CreateJobSchema.parse(req.body);
    const job = jobService.create(input);

    // Broadcast to connected clients
    wsHub.broadcastJobNew(job);

    res.status(201).json({
      success: true,
      job: jobService.serialize(job),
    });
  } catch (error) {
    if (error instanceof ZodError) {
      return res.status(400).json({
        error: "Validation failed",
        fields: error.errors.map(e => e.path.join(".")),
      });
    }
    return res.status(400).json({ error: sanitizeError(error) });
  }
});

// GET /api/v1/jobs - List jobs
router.get("/", async (req: Request, res: Response) => {
  try {
    const statusParam = req.query.status as string | undefined;

    // Validate status parameter
    let status: JobStatus | undefined;
    if (statusParam) {
      if (!VALID_STATUSES.includes(statusParam)) {
        return res.status(400).json({ error: "Invalid status filter" });
      }
      status = statusParam as JobStatus;
    }

    const jobs = status ? jobService.list(status) : jobService.list();

    res.json({
      success: true,
      count: jobs.length,
      jobs: jobService.serializeMany(jobs),
    });
  } catch (error) {
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/v1/jobs/open - List open jobs (convenience endpoint)
router.get("/open", async (req: Request, res: Response) => {
  try {
    const jobs = jobService.listOpen();

    res.json({
      success: true,
      count: jobs.length,
      jobs: jobService.serializeMany(jobs),
    });
  } catch (error) {
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/v1/jobs/:id - Get job details
router.get("/:id", async (req: Request<{ id: string }>, res: Response) => {
  try {
    const job = jobService.get(req.params.id);
    if (!job) {
      return res.status(404).json({ error: "Job not found" });
    }

    res.json({
      success: true,
      job: jobService.serialize(job),
    });
  } catch (error) {
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/v1/jobs/:id/claim - Claim a job
router.post("/:id/claim", async (req: Request<{ id: string }>, res: Response) => {
  try {
    const input = ClaimJobSchema.parse(req.body);
    const job = jobService.claim(req.params.id, input.workerWallet);

    if (!job) {
      return res.status(400).json({ error: "Failed to claim job" });
    }

    // Broadcast to connected clients
    wsHub.broadcastJobClaimed(job);

    res.json({
      success: true,
      message: "Job claimed successfully",
      job: jobService.serialize(job),
    });
  } catch (error) {
    if (error instanceof ZodError) {
      return res.status(400).json({
        error: "Validation failed",
        fields: error.errors.map(e => e.path.join(".")),
      });
    }
    return res.status(400).json({ error: sanitizeError(error) });
  }
});

// POST /api/v1/jobs/:id/complete - Complete a job with result
router.post("/:id/complete", async (req: Request<{ id: string }>, res: Response) => {
  try {
    const input = CompleteJobSchema.parse(req.body);
    const job = jobService.complete(
      req.params.id,
      input.result,
      input.workerWallet
    );

    if (!job) {
      return res.status(400).json({ error: "Failed to complete job" });
    }

    // Broadcast to connected clients
    wsHub.broadcastJobCompleted(job);

    res.json({
      success: true,
      message: "Job completed. Result available at /api/v1/results/" + job.id,
      job: jobService.serialize(job),
    });
  } catch (error) {
    if (error instanceof ZodError) {
      return res.status(400).json({
        error: "Validation failed",
        fields: error.errors.map(e => e.path.join(".")),
      });
    }
    return res.status(400).json({ error: sanitizeError(error) });
  }
});

// GET /api/v1/jobs/:id/verify - Verify completed job (for job poster)
// Allows requester to see proof of completion before paying
router.get("/:id/verify", async (req: Request<{ id: string }>, res: Response) => {
  try {
    const job = jobService.get(req.params.id);
    if (!job) {
      return res.status(404).json({ error: "Job not found" });
    }

    // Check if job is completed or paid
    if (job.status !== JobStatus.COMPLETED && job.status !== JobStatus.PAID) {
      return res.status(400).json({
        error: "Job not completed",
        status: job.status,
        message: "Verification only available for completed jobs"
      });
    }

    // Get the result
    const resultData = jobService.getResult(job.id);
    if (!resultData) {
      return res.status(404).json({ error: "Result not found" });
    }

    // Create verification proof
    const resultHash = hashResult(resultData.result);
    const preview = resultData.result.substring(0, 100) + (resultData.result.length > 100 ? "..." : "");

    res.json({
      success: true,
      verification: {
        jobId: job.id,
        title: job.title,
        status: job.status,
        completedAt: job.completedAt,
        worker: job.workerWallet,
        proof: {
          resultHash: resultHash,
          resultLength: resultData.result.length,
          preview: preview,
          algorithm: "sha256"
        },
        payment: {
          required: job.status === JobStatus.COMPLETED,
          paid: job.status === JobStatus.PAID,
          bountyUsdc: job.bountyUsdc,
          paymentEndpoint: `/api/v1/results/${job.id}`
        }
      },
      message: job.status === JobStatus.COMPLETED
        ? "Job completed. Pay via x402 to get full result. Hash can be used to verify result integrity after payment."
        : "Job paid. Full result available at payment endpoint."
    });
  } catch (error) {
    console.error("Error verifying job:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/v1/jobs/:id/verify-hash - Verify result matches expected hash
router.post("/:id/verify-hash", async (req: Request<{ id: string }>, res: Response) => {
  try {
    const { expectedHash } = req.body;
    if (!expectedHash) {
      return res.status(400).json({ error: "expectedHash required in body" });
    }

    const job = jobService.get(req.params.id);
    if (!job) {
      return res.status(404).json({ error: "Job not found" });
    }

    const resultData = jobService.getResult(job.id);
    if (!resultData) {
      return res.status(404).json({ error: "Result not found" });
    }

    const actualHash = hashResult(resultData.result);
    const matches = actualHash === expectedHash;

    res.json({
      success: true,
      verification: {
        jobId: job.id,
        hashMatches: matches,
        message: matches
          ? "Result integrity verified - hash matches"
          : "Hash mismatch - result may have been tampered with"
      }
    });
  } catch (error) {
    console.error("Error verifying hash:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
