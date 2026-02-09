import "dotenv/config";
import { createServer } from "http";
import { createApp } from "./server/app.js";
import { wsHub } from "./server/websocket/hub.js";
import { PORT, HOST } from "./config/constants.js";
import { initDatabase, checkConnection } from "./db/index.js";

async function main() {
  console.log("Starting AgentWork Marketplace...");

  // Initialize database
  if (process.env.DATABASE_URL) {
    console.log("Connecting to PostgreSQL...");
    try {
      await initDatabase();
      const connected = await checkConnection();
      if (connected) {
        console.log("Database connected successfully");
      }
    } catch (error) {
      console.error("Database initialization failed:", error);
      console.log("Continuing without database persistence...");
    }
  } else {
    console.log("No DATABASE_URL found - data will not persist across restarts");
  }

  // Create Express app
  const app = createApp();

  // Create HTTP server
  const server = createServer(app);

  // Initialize WebSocket hub
  wsHub.initialize(server);

  // Start server
  server.listen(PORT, HOST, () => {
    console.log(`
╔════════════════════════════════════════════════════════════╗
║              AgentWork Marketplace                         ║
╠════════════════════════════════════════════════════════════╣
║  HTTP Server:  http://${HOST}:${PORT}                         ║
║  WebSocket:    ws://${HOST}:${PORT}/ws                        ║
║  Network:      Solana Devnet                               ║
║  Database:     ${process.env.DATABASE_URL ? "PostgreSQL" : "In-Memory"}                           ║
╚════════════════════════════════════════════════════════════╝

API Endpoints:
  POST   /api/v1/jobs           - Create a job with bounty
  GET    /api/v1/jobs           - List all jobs
  GET    /api/v1/jobs/open      - List available jobs
  GET    /api/v1/jobs/:id       - Get job details
  POST   /api/v1/jobs/:id/claim - Claim a job
  POST   /api/v1/jobs/:id/complete - Submit result
  GET    /api/v1/results/:jobId - Get result (x402 paywalled)

WebSocket Events:
  job.new       - New job posted
  job.claimed   - Job claimed by worker
  job.completed - Job completed, result available
  job.paid      - Payment received, result delivered
`);
  });

  // Graceful shutdown
  process.on("SIGTERM", () => {
    console.log("\nShutting down...");
    server.close(() => {
      console.log("Server closed");
      process.exit(0);
    });
  });

  process.on("SIGINT", () => {
    console.log("\nShutting down...");
    server.close(() => {
      console.log("Server closed");
      process.exit(0);
    });
  });
}

main().catch((error) => {
  console.error("Failed to start server:", error);
  process.exit(1);
});
