/**
 * OpenClaw Marketplace Skill Implementation
 *
 * This skill allows bots to interact with the marketplace API
 * to post jobs, claim work, and handle x402 payments.
 */

import { Keypair, Transaction } from "@solana/web3.js";
import bs58 from "bs58";

// Configuration
const MARKETPLACE_URL = process.env.MARKETPLACE_URL || "http://localhost:3000";
const BOT_WALLET_SECRET = process.env.BOT_WALLET_SECRET_KEY;

interface MarketplaceConfig {
  url: string;
  wallet: Keypair | null;
}

interface Job {
  id: string;
  title: string;
  description: string;
  bountyUsdc: number;
  status: string;
  requesterWallet: string;
  workerWallet: string | null;
}

interface PaymentRequired {
  accepts: Array<{
    scheme: string;
    network: string;
    maxAmountRequired: string;
    asset: string;
    payTo: string;
  }>;
}

class MarketplaceClient {
  private config: MarketplaceConfig;

  constructor() {
    this.config = {
      url: MARKETPLACE_URL,
      wallet: BOT_WALLET_SECRET ? this.loadWallet(BOT_WALLET_SECRET) : null,
    };
  }

  private loadWallet(secretKeyBase58: string): Keypair {
    const secretKey = bs58.decode(secretKeyBase58);
    return Keypair.fromSecretKey(secretKey);
  }

  get walletAddress(): string | null {
    return this.config.wallet?.publicKey.toBase58() || null;
  }

  // POST /api/v1/jobs - Create a new job
  async postJob(
    title: string,
    description: string,
    bountyUsdc: number
  ): Promise<Job> {
    if (!this.config.wallet) {
      throw new Error("Wallet not configured");
    }

    const response = await fetch(`${this.config.url}/api/v1/jobs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title,
        description,
        bountyUsdc,
        requesterWallet: this.walletAddress,
      }),
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || "Failed to post job");
    }

    return data.job;
  }

  // GET /api/v1/jobs - List jobs
  async listJobs(status?: string): Promise<Job[]> {
    const url = status
      ? `${this.config.url}/api/v1/jobs?status=${status}`
      : `${this.config.url}/api/v1/jobs`;

    const response = await fetch(url);
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "Failed to list jobs");
    }

    return data.jobs;
  }

  // GET /api/v1/jobs/:id - Get job details
  async getJob(jobId: string): Promise<Job> {
    const response = await fetch(`${this.config.url}/api/v1/jobs/${jobId}`);
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "Job not found");
    }

    return data.job;
  }

  // POST /api/v1/jobs/:id/claim - Claim a job
  async claimJob(jobId: string): Promise<Job> {
    if (!this.config.wallet) {
      throw new Error("Wallet not configured");
    }

    const response = await fetch(`${this.config.url}/api/v1/jobs/${jobId}/claim`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        workerWallet: this.walletAddress,
      }),
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || "Failed to claim job");
    }

    return data.job;
  }

  // POST /api/v1/jobs/:id/complete - Complete a job
  async completeJob(jobId: string, result: string): Promise<Job> {
    if (!this.config.wallet) {
      throw new Error("Wallet not configured");
    }

    const response = await fetch(
      `${this.config.url}/api/v1/jobs/${jobId}/complete`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          result,
          workerWallet: this.walletAddress,
        }),
      }
    );

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || "Failed to complete job");
    }

    return data.job;
  }

  // GET /api/v1/results/:jobId - Fetch result with x402 payment
  async fetchResult(jobId: string): Promise<{ result: string; txSig?: string }> {
    if (!this.config.wallet) {
      throw new Error("Wallet not configured");
    }

    // First request - expect 402
    let response = await fetch(`${this.config.url}/api/v1/results/${jobId}`);

    if (response.status === 402) {
      // Parse payment requirements
      const paymentHeader = response.headers.get("X-Payment-Required");
      if (!paymentHeader) {
        throw new Error("Missing X-Payment-Required header");
      }

      const paymentReq: PaymentRequired = JSON.parse(
        Buffer.from(paymentHeader, "base64").toString("utf-8")
      );

      // Build and sign payment transaction
      const paymentData = await this.buildPayment(paymentReq);

      // Retry with payment
      response = await fetch(`${this.config.url}/api/v1/results/${jobId}`, {
        headers: {
          "X-Payment": paymentData,
        },
      });
    }

    if (!response.ok) {
      const data = await response.json();
      throw new Error(data.error || "Failed to fetch result");
    }

    const data = await response.json();
    return {
      result: data.result,
      txSig: data.payment?.txSig,
    };
  }

  // Build x402 payment
  private async buildPayment(paymentReq: PaymentRequired): Promise<string> {
    if (!this.config.wallet) {
      throw new Error("Wallet not configured");
    }

    const accept = paymentReq.accepts[0];
    if (!accept || accept.scheme !== "exact") {
      throw new Error("Unsupported payment scheme");
    }

    // Import transfer instruction builder
    const { createTransferInstruction } = await import("@solana/spl-token");
    const { getAssociatedTokenAddress } = await import("@solana/spl-token");
    const { Connection, PublicKey, Transaction } = await import("@solana/web3.js");

    // Connect to Solana
    const rpcUrl = accept.network.includes("devnet")
      ? "https://api.devnet.solana.com"
      : "https://api.mainnet-beta.solana.com";
    const conn = new Connection(rpcUrl, "confirmed");

    const mint = new PublicKey(accept.asset);
    const recipient = new PublicKey(accept.payTo);
    const amount = BigInt(accept.maxAmountRequired);

    // Get ATAs
    const senderAta = await getAssociatedTokenAddress(
      mint,
      this.config.wallet.publicKey
    );
    const recipientAta = await getAssociatedTokenAddress(mint, recipient);

    // Build transfer instruction
    const transferIx = createTransferInstruction(
      senderAta,
      recipientAta,
      this.config.wallet.publicKey,
      amount
    );

    // Build transaction
    const tx = new Transaction().add(transferIx);
    const { blockhash } = await conn.getLatestBlockhash();
    tx.recentBlockhash = blockhash;
    tx.feePayer = this.config.wallet.publicKey;

    // Sign transaction
    tx.sign(this.config.wallet);

    // Serialize and encode
    const serialized = tx.serialize();
    const paymentData = {
      serializedTransaction: serialized.toString("base64"),
    };

    return Buffer.from(JSON.stringify(paymentData)).toString("base64");
  }
}

// Skill command parser
export async function executeMarketplaceCommand(input: string): Promise<string> {
  const client = new MarketplaceClient();

  // Parse command
  const parts = input.trim().split(/\s+/);
  const command = parts[0]?.toLowerCase();

  try {
    switch (command) {
      case "post": {
        // Format: post <bounty> <title> - <description>
        const bounty = parseFloat(parts[1]);
        if (isNaN(bounty)) {
          return "Error: Invalid bounty amount";
        }
        const rest = parts.slice(2).join(" ");
        const [title, ...descParts] = rest.split(" - ");
        const description = descParts.join(" - ");

        if (!title || !description) {
          return "Error: Format: post <bounty> <title> - <description>";
        }

        const job = await client.postJob(title.trim(), description.trim(), bounty);
        return `Job posted!\nID: ${job.id}\nTitle: ${job.title}\nBounty: ${job.bountyUsdc} USDC`;
      }

      case "list": {
        const status = parts[1];
        const jobs = await client.listJobs(status);

        if (jobs.length === 0) {
          return `No ${status || ""} jobs found.`;
        }

        return jobs
          .map(
            (j) =>
              `[${j.id}] ${j.title} - ${j.bountyUsdc} USDC (${j.status})`
          )
          .join("\n");
      }

      case "claim": {
        const jobId = parts[1];
        if (!jobId) {
          return "Error: Specify job ID";
        }

        const job = await client.claimJob(jobId);
        return `Job claimed!\nID: ${job.id}\nTitle: ${job.title}\nBounty: ${job.bountyUsdc} USDC`;
      }

      case "complete": {
        // Format: complete <job_id> - <result>
        const jobId = parts[1];
        const rest = parts.slice(2).join(" ");
        const result = rest.startsWith("- ") ? rest.slice(2) : rest;

        if (!jobId || !result) {
          return "Error: Format: complete <job_id> - <result>";
        }

        const job = await client.completeJob(jobId, result.trim());
        return `Job completed!\nID: ${job.id}\nResult submitted. Awaiting payment.`;
      }

      case "fetch": {
        const jobId = parts[1];
        if (!jobId) {
          return "Error: Specify job ID";
        }

        const { result, txSig } = await client.fetchResult(jobId);
        return `Result fetched!\n${txSig ? `Payment TX: ${txSig}\n` : ""}Result:\n${result}`;
      }

      case "status": {
        const jobId = parts[1];
        if (!jobId) {
          return "Error: Specify job ID";
        }

        const job = await client.getJob(jobId);
        return `Job: ${job.id}\nTitle: ${job.title}\nStatus: ${job.status}\nBounty: ${job.bountyUsdc} USDC\nRequester: ${job.requesterWallet}\nWorker: ${job.workerWallet || "None"}`;
      }

      default:
        return `Unknown command: ${command}\nAvailable: post, list, claim, complete, fetch, status`;
    }
  } catch (error) {
    return `Error: ${error instanceof Error ? error.message : "Unknown error"}`;
  }
}

// Export client for direct use
export { MarketplaceClient };
