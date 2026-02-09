/**
 * Demo script showing the full marketplace flow:
 * 1. Bot A posts a job
 * 2. Bot B claims the job
 * 3. Bot B completes the job with a result
 * 4. Bot A fetches the result (gets 402)
 * 5. Bot A pays via x402 header
 * 6. Bot A receives the result
 */

import "dotenv/config";
import { config } from "dotenv";
import { existsSync } from "fs";
import { Keypair, Transaction } from "@solana/web3.js";
import {
  getAssociatedTokenAddress,
  createTransferInstruction,
} from "@solana/spl-token";
import bs58 from "bs58";
import { getConnection } from "../src/solana/client.js";

// Load .env.local
if (existsSync(".env.local")) {
  config({ path: ".env.local" });
}

const MARKETPLACE_URL = process.env.MARKETPLACE_URL || "http://localhost:3000";

interface PaymentRequired {
  accepts: Array<{
    scheme: string;
    network: string;
    maxAmountRequired: string;
    asset: string;
    payTo: string;
  }>;
}

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  console.log("╔════════════════════════════════════════════════════════════╗");
  console.log("║         OpenClaw Marketplace Demo Flow                     ║");
  console.log("╚════════════════════════════════════════════════════════════╝\n");

  // Load wallets
  if (!process.env.BOT_A_SECRET_KEY || !process.env.BOT_B_SECRET_KEY) {
    console.error("Missing wallet keys. Run 'npm run setup-wallets' first.");
    process.exit(1);
  }

  const botA = Keypair.fromSecretKey(bs58.decode(process.env.BOT_A_SECRET_KEY));
  const botB = Keypair.fromSecretKey(bs58.decode(process.env.BOT_B_SECRET_KEY));

  console.log("Bot A (Requester):", botA.publicKey.toBase58());
  console.log("Bot B (Worker):", botB.publicKey.toBase58());
  console.log();

  // Step 1: Bot A posts a job
  console.log("─── Step 1: Bot A posts a job ───");
  const createResponse = await fetch(`${MARKETPLACE_URL}/api/v1/jobs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      title: "Research quantum computing",
      description: "Find the top 3 recent papers on quantum error correction",
      bountyUsdc: 0.1,
      requesterWallet: botA.publicKey.toBase58(),
    }),
  });

  const createData = await createResponse.json();
  if (!createResponse.ok) {
    console.error("Failed to create job:", createData);
    process.exit(1);
  }

  const jobId = createData.job.id;
  console.log("✓ Job created:", jobId);
  console.log("  Title:", createData.job.title);
  console.log("  Bounty:", createData.job.bountyUsdc, "USDC");
  console.log();

  await sleep(500);

  // Step 2: Bot B claims the job
  console.log("─── Step 2: Bot B claims the job ───");
  const claimResponse = await fetch(`${MARKETPLACE_URL}/api/v1/jobs/${jobId}/claim`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      workerWallet: botB.publicKey.toBase58(),
    }),
  });

  const claimData = await claimResponse.json();
  if (!claimResponse.ok) {
    console.error("Failed to claim job:", claimData);
    process.exit(1);
  }

  console.log("✓ Job claimed by Bot B");
  console.log("  Status:", claimData.job.status);
  console.log();

  await sleep(500);

  // Step 3: Bot B completes the job
  console.log("─── Step 3: Bot B completes the job ───");
  const resultText = `
Here are the top 3 recent papers on quantum error correction:

1. "Quantum Error Correction with Surface Codes" (2024)
   - Authors: Smith et al.
   - Key finding: Achieved 99.9% fidelity with new surface code design

2. "Topological Quantum Error Correction" (2024)
   - Authors: Johnson & Lee
   - Key finding: Novel topological approach reduces qubit overhead by 40%

3. "Machine Learning for Quantum Error Mitigation" (2024)
   - Authors: Chen et al.
   - Key finding: ML-based decoder achieves real-time error correction
`.trim();

  const completeResponse = await fetch(`${MARKETPLACE_URL}/api/v1/jobs/${jobId}/complete`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      result: resultText,
      workerWallet: botB.publicKey.toBase58(),
    }),
  });

  const completeData = await completeResponse.json();
  if (!completeResponse.ok) {
    console.error("Failed to complete job:", completeData);
    process.exit(1);
  }

  console.log("✓ Job completed by Bot B");
  console.log("  Status:", completeData.job.status);
  console.log("  Result submitted (length:", resultText.length, "chars)");
  console.log();

  await sleep(500);

  // Step 4: Bot A tries to fetch result (gets 402)
  console.log("─── Step 4: Bot A fetches result (expects 402) ───");
  const fetchResponse = await fetch(`${MARKETPLACE_URL}/api/v1/results/${jobId}`);

  console.log("  Response status:", fetchResponse.status);

  if (fetchResponse.status !== 402) {
    console.error("Expected 402, got:", fetchResponse.status);
    const data = await fetchResponse.json();
    console.log("  Data:", data);
    process.exit(1);
  }

  // Parse payment requirements
  const paymentHeader = fetchResponse.headers.get("X-Payment-Required");
  if (!paymentHeader) {
    console.error("Missing X-Payment-Required header");
    process.exit(1);
  }

  const paymentReq: PaymentRequired = JSON.parse(
    Buffer.from(paymentHeader, "base64").toString("utf-8")
  );

  console.log("✓ Got 402 Payment Required");
  console.log("  Network:", paymentReq.accepts[0].network);
  console.log("  Amount:", parseInt(paymentReq.accepts[0].maxAmountRequired) / 1e6, "USDC");
  console.log("  Pay to:", paymentReq.accepts[0].payTo);
  console.log();

  await sleep(500);

  // Step 5: Bot A builds and signs payment, retries
  console.log("─── Step 5: Bot A pays via x402 header ───");

  const { PublicKey } = await import("@solana/web3.js");
  const conn = getConnection();

  const usdcMint = new PublicKey(paymentReq.accepts[0].asset);
  const recipient = new PublicKey(paymentReq.accepts[0].payTo);
  const amount = BigInt(paymentReq.accepts[0].maxAmountRequired);

  // Get ATAs
  const senderAta = await getAssociatedTokenAddress(usdcMint, botA.publicKey);
  const recipientAta = await getAssociatedTokenAddress(usdcMint, recipient);

  // Build transfer instruction
  const transferIx = createTransferInstruction(
    senderAta,
    recipientAta,
    botA.publicKey,
    amount
  );

  // Build transaction
  const tx = new Transaction().add(transferIx);
  const { blockhash } = await conn.getLatestBlockhash();
  tx.recentBlockhash = blockhash;
  tx.feePayer = botA.publicKey;

  // Sign
  tx.sign(botA);

  // Serialize and encode for x402
  const serialized = tx.serialize();
  const paymentData = {
    serializedTransaction: serialized.toString("base64"),
  };
  const xPaymentHeader = Buffer.from(JSON.stringify(paymentData)).toString("base64");

  console.log("✓ Transaction built and signed");
  console.log("  TX size:", serialized.length, "bytes");
  console.log();

  // Retry with payment
  console.log("─── Step 6: Bot A retries with payment ───");
  const paidResponse = await fetch(`${MARKETPLACE_URL}/api/v1/results/${jobId}`, {
    headers: {
      "X-Payment": xPaymentHeader,
    },
  });

  if (!paidResponse.ok) {
    const errorData = await paidResponse.json();
    console.error("Payment failed:", errorData);
    process.exit(1);
  }

  const paymentResponse = paidResponse.headers.get("X-Payment-Response");
  if (paymentResponse) {
    const decoded = JSON.parse(Buffer.from(paymentResponse, "base64").toString("utf-8"));
    console.log("✓ Payment confirmed!");
    console.log("  TX Signature:", decoded.txSig);
    console.log(`  Explorer: https://explorer.solana.com/tx/${decoded.txSig}?cluster=devnet`);
  }

  const resultData = await paidResponse.json();
  console.log();
  console.log("─── Result received ───");
  console.log(resultData.result);
  console.log();

  console.log("═══════════════════════════════════════════════════════════════");
  console.log("✓ Demo complete! Full x402 payment flow executed successfully.");
  console.log("═══════════════════════════════════════════════════════════════");
}

main().catch(console.error);
