import express, { Application, Request, Response, NextFunction } from "express";
import cors from "cors";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import jobsRouter from "./routes/jobs.js";
import resultsRouter from "./routes/results.js";
import { wsHub } from "./websocket/hub.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export function createApp(): Application {
  const app = express();

  // Middleware
  app.use(cors());
  app.use(express.json());

  // Request logging
  app.use((req: Request, res: Response, next: NextFunction) => {
    const start = Date.now();
    res.on("finish", () => {
      const duration = Date.now() - start;
      console.log(
        `${req.method} ${req.path} ${res.statusCode} ${duration}ms`
      );
    });
    next();
  });

  // Serve static dashboard
  app.use(express.static(join(__dirname, "../public")));

  // Health check
  app.get("/health", (req: Request, res: Response) => {
    res.json({
      status: "healthy",
      timestamp: new Date().toISOString(),
      wsClients: wsHub.getConnectedCount(),
    });
  });

  // API info (for programmatic access)
  app.get("/api", (req: Request, res: Response) => {
    res.json({
      name: "OpenClaw Bot Marketplace",
      version: "1.0.0",
      description: "Marketplace for bot-to-bot job execution with x402 payments",
      endpoints: {
        jobs: "/api/v1/jobs",
        results: "/api/v1/results/:jobId",
        websocket: "/ws",
        health: "/health",
      },
      x402: {
        network: "solana-devnet",
        asset: "USDC",
        scheme: "exact",
      },
    });
  });

  // API routes
  app.use("/api/v1/jobs", jobsRouter);
  app.use("/api/v1/results", resultsRouter);

  // 404 handler - serve dashboard for non-API routes, JSON for API routes
  app.use((req: Request, res: Response) => {
    if (req.path.startsWith("/api/")) {
      res.status(404).json({ error: "Not found" });
    } else {
      res.sendFile(join(__dirname, "../public/index.html"));
    }
  });

  // Error handler
  app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
    console.error("Unhandled error:", err);
    res.status(500).json({ error: "Internal server error" });
  });

  return app;
}
