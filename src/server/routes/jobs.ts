import { Router, Request, Response } from "express";
import { jobService } from "../../services/job-service.js";
import { CreateJobSchema, ClaimJobSchema, CompleteJobSchema } from "../../models/job.js";
import { JobStatus } from "../../config/constants.js";
import { wsHub } from "../websocket/hub.js";
import { ZodError } from "zod";

const router = Router();

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
        details: error.errors,
      });
    }
    if (error instanceof Error) {
      return res.status(400).json({ error: error.message });
    }
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/v1/jobs - List jobs
router.get("/", async (req: Request, res: Response) => {
  try {
    const status = req.query.status as JobStatus | undefined;
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
        details: error.errors,
      });
    }
    if (error instanceof Error) {
      return res.status(400).json({ error: error.message });
    }
    res.status(500).json({ error: "Internal server error" });
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
        details: error.errors,
      });
    }
    if (error instanceof Error) {
      return res.status(400).json({ error: error.message });
    }
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
