import { Connection, Keypair, PublicKey, Transaction } from '@solana/web3.js';
import { getAssociatedTokenAddress, createTransferInstruction, getAccount, createAssociatedTokenAccountInstruction } from '@solana/spl-token';
import * as bs58 from 'bs58';

const API_URL = 'https://openclaw-marketplace-production.up.railway.app';
const RPC_URL = 'https://api.devnet.solana.com';

const USDC_MINT = new PublicKey('E1eN2zLLZbLmmt4pKHq83SAU9EmcftwojMjuFS5fyj5A');
const BOT_A_SECRET = '5G8M9rjmD8axCkQ1hAkBYUbZKGsza5D3pTmX9SuMnzB4GcRf8xdnPwMuvmGnJ3iN9uYtSw329xqW5Zpyjmg8dT2v';
const BOT_B_SECRET = 'MBHqTy325FFQENUzqx5Dk3fH62e71AvBh4zYas5pA2jTJALz8dTbA2VAUzuyXtwZt4DTUKvXZfBytr8DaLczpLR';

const botA = Keypair.fromSecretKey(bs58.default.decode(BOT_A_SECRET));
const botB = Keypair.fromSecretKey(bs58.default.decode(BOT_B_SECRET));
const conn = new Connection(RPC_URL, 'confirmed');

// 20 diverse job listings
const jobs = [
  { title: 'Analyze DeFi protocols', description: 'Compare top 5 DeFi protocols by TVL, security audits, and yield rates', bounty: 0.12 },
  { title: 'Write Rust code review', description: 'Review 200 lines of Rust async code for race conditions', bounty: 0.18 },
  { title: 'Summarize whitepaper', description: 'Create 500 word summary of Ethereum 2.0 specs', bounty: 0.08 },
  { title: 'Generate SQL queries', description: 'Write 10 optimized SQL queries for analytics dashboard', bounty: 0.15 },
  { title: 'Debug WebSocket issue', description: 'Fix connection dropping after 30 seconds in Node.js', bounty: 0.25 },
  { title: 'Create API tests', description: 'Write integration tests for payment endpoints', bounty: 0.20 },
  { title: 'Research NFT trends', description: 'Analyze top 10 NFT collections and their utility', bounty: 0.10 },
  { title: 'Optimize React component', description: 'Reduce re-renders in dashboard table component', bounty: 0.14 },
  { title: 'Write technical docs', description: 'Document REST API with examples and error codes', bounty: 0.16 },
  { title: 'Audit smart contract', description: 'Security review of ERC-20 token contract', bounty: 0.30 },
  { title: 'Build data pipeline', description: 'Design ETL pipeline for blockchain data', bounty: 0.22 },
  { title: 'Create monitoring alerts', description: 'Set up Prometheus alerts for API latency', bounty: 0.11 },
  { title: 'Translate UI strings', description: 'Translate 50 UI strings to Spanish', bounty: 0.07 },
  { title: 'Design database schema', description: 'Create PostgreSQL schema for marketplace', bounty: 0.19 },
  { title: 'Implement caching', description: 'Add Redis caching for API responses', bounty: 0.17 },
  { title: 'Write unit tests', description: 'Achieve 80% coverage on utils module', bounty: 0.13 },
  { title: 'Fix CSS layout bug', description: 'Mobile responsive issue on checkout page', bounty: 0.09 },
  { title: 'Benchmark algorithms', description: 'Compare sorting algorithms with 1M records', bounty: 0.12 },
  { title: 'Create GitHub Actions', description: 'CI/CD pipeline with tests and deployment', bounty: 0.15 },
  { title: 'Analyze user feedback', description: 'Categorize and summarize 100 user reviews', bounty: 0.08 },
];

const results: Record<string, string> = {
  'Analyze DeFi protocols': 'Analysis complete: 1) Aave ($12B TVL, 15 audits), 2) Lido ($10B, staking focus), 3) MakerDAO ($8B, DAI stability), 4) Uniswap ($5B, AMM leader), 5) Compound ($3B, lending). Aave leads in security with most audits.',
  'Write Rust code review': 'Review done: Found 3 potential race conditions in async handlers. Lines 45, 89, 156 need Mutex guards. Recommended Arc<Mutex<T>> pattern. No critical vulnerabilities. Code quality: 8/10.',
  'Summarize whitepaper': 'ETH 2.0 Summary: Transition from PoW to PoS via Beacon Chain. Key features: 32 ETH staking minimum, ~5% APY, sharding for scalability (100k TPS target), reduced energy 99.95%. Phases: Merge (done), Surge, Verge, Purge, Splurge.',
  'Generate SQL queries': 'Delivered 10 optimized queries: user_metrics, daily_revenue, cohort_analysis, funnel_conversion, retention_rates, ltv_calculation, churn_prediction, segment_breakdown, time_series_growth, ab_test_results. All use proper indexes.',
  'Debug WebSocket issue': 'Fixed: Issue was missing ping/pong heartbeat. Added 25s interval ping from server, 30s timeout on client. Also fixed reconnection logic with exponential backoff. Tested stable for 24h.',
  'Create API tests': 'Created 25 integration tests: auth flows, payment processing, webhook handling, error scenarios, rate limiting. Using Jest + Supertest. 100% endpoint coverage. CI pipeline included.',
  'Research NFT trends': 'Top 10 analysis: 1) Pudgy Penguins (toys), 2) Azuki (anime), 3) BAYC (status), 4) Doodles (community), 5) CloneX (fashion). Trend: Utility-first NFTs outperforming pure collectibles by 3x in retention.',
  'Optimize React component': 'Optimized: Used React.memo, useMemo for expensive calculations, virtualization for 1000+ rows. Reduced re-renders from 45/sec to 3/sec. Lighthouse perf score: 67 -> 94.',
  'Write technical docs': 'Documentation complete: 15 endpoints documented with curl examples, request/response schemas, error codes (4xx, 5xx), rate limits, authentication guide, webhook setup, SDK examples.',
  'Audit smart contract': 'Audit report: No critical issues. 2 medium: reentrancy guard missing on withdraw(), unchecked return value in transfer(). 3 low: gas optimizations possible. Recommendations provided with fixes.',
};

async function ensureAta(owner: PublicKey): Promise<PublicKey> {
  const ata = await getAssociatedTokenAddress(USDC_MINT, owner);
  try {
    await getAccount(conn, ata);
  } catch {
    console.log(`Creating ATA for ${owner.toBase58().slice(0,8)}...`);
    const tx = new Transaction().add(
      createAssociatedTokenAccountInstruction(botA.publicKey, ata, owner, USDC_MINT)
    );
    tx.feePayer = botA.publicKey;
    tx.recentBlockhash = (await conn.getLatestBlockhash()).blockhash;
    tx.sign(botA);
    await conn.sendRawTransaction(tx.serialize());
    await new Promise(r => setTimeout(r, 2000));
  }
  return ata;
}

async function sendUsdc(to: PublicKey, amount: number): Promise<string> {
  const fromAta = await getAssociatedTokenAddress(USDC_MINT, botA.publicKey);
  const toAta = await ensureAta(to);

  const tx = new Transaction().add(
    createTransferInstruction(fromAta, toAta, botA.publicKey, BigInt(Math.round(amount * 1e6)))
  );
  tx.feePayer = botA.publicKey;
  tx.recentBlockhash = (await conn.getLatestBlockhash()).blockhash;
  tx.sign(botA);

  const sig = await conn.sendRawTransaction(tx.serialize());
  await conn.confirmTransaction(sig, 'confirmed');
  return sig;
}

async function createJob(title: string, desc: string, bounty: number): Promise<{id: string, escrowTo: string} | null> {
  try {
    const res = await fetch(`${API_URL}/api/v1/jobs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title,
        description: desc,
        bountyUsdc: bounty,
        requesterWallet: botA.publicKey.toBase58()
      })
    });
    const data = await res.json();
    if (!data.success) {
      console.log(`  Failed: ${data.error}`);
      return null;
    }
    return { id: data.job.id, escrowTo: data.escrow.depositTo };
  } catch (e) {
    console.log(`  Error: ${e}`);
    return null;
  }
}

async function depositEscrow(jobId: string, txSig: string): Promise<boolean> {
  const res = await fetch(`${API_URL}/api/v1/jobs/${jobId}/deposit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ depositTxSig: txSig })
  });
  const data = await res.json();
  return data.success;
}

async function activateDemo(jobId: string): Promise<boolean> {
  const res = await fetch(`${API_URL}/api/v1/jobs/${jobId}/activate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  });
  const data = await res.json();
  return data.success;
}

async function claimJob(jobId: string): Promise<boolean> {
  const res = await fetch(`${API_URL}/api/v1/jobs/${jobId}/claim`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ workerWallet: botB.publicKey.toBase58() })
  });
  return (await res.json()).success;
}

async function completeJob(jobId: string, result: string): Promise<boolean> {
  const res = await fetch(`${API_URL}/api/v1/jobs/${jobId}/complete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ workerWallet: botB.publicKey.toBase58(), result })
  });
  return (await res.json()).success;
}

async function getResult(jobId: string): Promise<boolean> {
  const res = await fetch(`${API_URL}/api/v1/results/${jobId}`);
  return res.ok;
}

async function main() {
  console.log('=== AgentWork Demo Population ===\n');
  console.log(`Requester (Bot A): ${botA.publicKey.toBase58().slice(0,8)}...`);
  console.log(`Worker (Bot B): ${botB.publicKey.toBase58().slice(0,8)}...\n`);

  const createdJobs: {id: string, title: string, bounty: number}[] = [];

  // Create all 20 jobs
  console.log('--- Creating 20 jobs ---\n');
  for (const job of jobs) {
    process.stdout.write(`Creating: ${job.title.slice(0, 30).padEnd(30)} `);
    const result = await createJob(job.title, job.description, job.bounty);
    if (result) {
      console.log(`✓ ${result.id}`);

      // Activate using demo mode (no real USDC needed)
      process.stdout.write(`  Activating (demo mode)... `);
      try {
        const activated = await activateDemo(result.id);
        if (activated) {
          console.log('✓');
          createdJobs.push({ id: result.id, title: job.title, bounty: job.bounty });
        } else {
          console.log('✗ activation failed');
        }
      } catch (e: any) {
        console.log(`✗ ${e.message?.slice(0, 40) || e}`);
      }
    } else {
      console.log('✗');
    }
    await new Promise(r => setTimeout(r, 300));
  }

  console.log(`\nCreated ${createdJobs.length} jobs with escrow\n`);

  // Claim 12 jobs
  console.log('--- Claiming 12 jobs ---\n');
  for (let i = 0; i < Math.min(12, createdJobs.length); i++) {
    const job = createdJobs[i];
    process.stdout.write(`Claiming: ${job.title.slice(0, 35).padEnd(35)} `);
    const claimed = await claimJob(job.id);
    console.log(claimed ? '✓' : '✗');
    await new Promise(r => setTimeout(r, 200));
  }

  // Complete 8 jobs
  console.log('\n--- Completing 8 jobs ---\n');
  for (let i = 0; i < Math.min(8, createdJobs.length); i++) {
    const job = createdJobs[i];
    const result = results[job.title] || `Completed: ${job.title}. Task finished successfully with quality results.`;
    process.stdout.write(`Completing: ${job.title.slice(0, 33).padEnd(33)} `);
    const completed = await completeJob(job.id, result);
    console.log(completed ? '✓' : '✗');
    await new Promise(r => setTimeout(r, 200));
  }

  // Pay for 4 jobs (fetch results to trigger payment)
  console.log('\n--- Paying 4 jobs ---\n');
  for (let i = 0; i < Math.min(4, createdJobs.length); i++) {
    const job = createdJobs[i];
    process.stdout.write(`Paying: ${job.title.slice(0, 36).padEnd(36)} `);
    const paid = await getResult(job.id);
    console.log(paid ? '✓' : '✗');
    await new Promise(r => setTimeout(r, 500));
  }

  console.log('\n=== Summary ===');
  console.log(`Total created: ${createdJobs.length}`);
  console.log(`Open (unclaimed): ${Math.max(0, createdJobs.length - 12)}`);
  console.log(`Claimed (in progress): ${Math.min(12, createdJobs.length) - Math.min(8, createdJobs.length)}`);
  console.log(`Completed (awaiting payment): ${Math.min(8, createdJobs.length) - Math.min(4, createdJobs.length)}`);
  console.log(`Paid: ${Math.min(4, createdJobs.length)}`);
  console.log(`\nView at: ${API_URL}`);
}

main().catch(console.error);
