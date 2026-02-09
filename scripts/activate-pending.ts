import { Keypair } from '@solana/web3.js';
import * as bs58 from 'bs58';

const API_URL = 'https://openclaw-marketplace-production.up.railway.app';

const BOT_B_SECRET = 'MBHqTy325FFQENUzqx5Dk3fH62e71AvBh4zYas5pA2jTJALz8dTbA2VAUzuyXtwZt4DTUKvXZfBytr8DaLczpLR';
const botB = Keypair.fromSecretKey(bs58.default.decode(BOT_B_SECRET));

const results: Record<string, string> = {
  'Analyze DeFi protocols': 'Analysis complete: 1) Aave ($12B TVL, 15 audits), 2) Lido ($10B, staking focus), 3) MakerDAO ($8B, DAI stability), 4) Uniswap ($5B, AMM leader), 5) Compound ($3B, lending).',
  'Write Rust code review': 'Review done: Found 3 potential race conditions. Lines 45, 89, 156 need Mutex guards. Code quality: 8/10.',
  'Summarize whitepaper': 'ETH 2.0 Summary: PoS transition via Beacon Chain. 32 ETH staking min, ~5% APY, sharding for 100k TPS target, 99.95% energy reduction.',
  'Generate SQL queries': 'Delivered 10 optimized queries: user_metrics, daily_revenue, cohort_analysis, funnel_conversion, retention_rates, ltv_calculation, churn_prediction, segment_breakdown, time_series_growth, ab_test_results.',
  'Debug WebSocket issue': 'Fixed: Added 25s ping interval, 30s timeout, exponential backoff reconnection. Tested stable 24h.',
  'Create API tests': 'Created 25 integration tests covering auth, payments, webhooks, errors, rate limiting. 100% endpoint coverage.',
  'Research NFT trends': 'Top 5: Pudgy Penguins (toys), Azuki (anime), BAYC (status), Doodles (community), CloneX (fashion). Utility NFTs outperform by 3x.',
  'Optimize React component': 'Used React.memo, useMemo, virtualization. Reduced re-renders 45/sec to 3/sec. Lighthouse: 67 -> 94.',
  'Write technical docs': '15 endpoints documented with curl examples, schemas, error codes, rate limits, auth guide.',
  'Audit smart contract': 'No critical issues. 2 medium: missing reentrancy guard, unchecked return. 3 low: gas optimizations.',
};

async function fetchJobs(): Promise<any[]> {
  const res = await fetch(`${API_URL}/api/v1/jobs?status=pending_deposit`);
  const data = await res.json();
  return data.jobs || [];
}

async function activateJob(jobId: string): Promise<boolean> {
  const res = await fetch(`${API_URL}/api/v1/jobs/${jobId}/activate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  });
  const data = await res.json();
  if (!data.success && data.error) {
    console.log(`(${data.error})`);
  }
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

async function main() {
  console.log('=== AgentWork Demo Activation ===\n');
  console.log(`Worker (Bot B): ${botB.publicKey.toBase58().slice(0,8)}...\n`);

  // Get pending jobs
  console.log('Fetching pending jobs...');
  const pendingJobs = await fetchJobs();
  console.log(`Found ${pendingJobs.length} pending jobs\n`);

  if (pendingJobs.length === 0) {
    console.log('No pending jobs to activate.');
    return;
  }

  // Take first 20 jobs
  const jobsToProcess = pendingJobs.slice(0, 20);
  const activatedJobs: any[] = [];

  // Activate jobs (demo mode)
  console.log('--- Activating jobs (demo mode) ---\n');
  for (const job of jobsToProcess) {
    process.stdout.write(`Activating: ${job.title.slice(0, 35).padEnd(35)} `);
    const activated = await activateJob(job.id);
    console.log(activated ? '✓' : '✗');
    if (activated) {
      activatedJobs.push(job);
    }
    await new Promise(r => setTimeout(r, 200));
  }

  console.log(`\nActivated ${activatedJobs.length} jobs\n`);

  if (activatedJobs.length === 0) {
    console.log('\nNo jobs activated. Is DEMO_MODE=true set on Railway?');
    return;
  }

  // Claim 12 jobs
  console.log('--- Claiming 12 jobs ---\n');
  const claimedJobs: any[] = [];
  for (let i = 0; i < Math.min(12, activatedJobs.length); i++) {
    const job = activatedJobs[i];
    process.stdout.write(`Claiming: ${job.title.slice(0, 35).padEnd(35)} `);
    const claimed = await claimJob(job.id);
    console.log(claimed ? '✓' : '✗');
    if (claimed) claimedJobs.push(job);
    await new Promise(r => setTimeout(r, 200));
  }

  // Complete 8 jobs
  console.log('\n--- Completing 8 jobs ---\n');
  const completedJobs: any[] = [];
  for (let i = 0; i < Math.min(8, claimedJobs.length); i++) {
    const job = claimedJobs[i];
    const result = results[job.title] || `Completed: ${job.title}. Task finished successfully.`;
    process.stdout.write(`Completing: ${job.title.slice(0, 33).padEnd(33)} `);
    const completed = await completeJob(job.id, result);
    console.log(completed ? '✓' : '✗');
    if (completed) completedJobs.push(job);
    await new Promise(r => setTimeout(r, 200));
  }

  console.log('\n=== Summary ===');
  console.log(`Open (unclaimed): ${activatedJobs.length - claimedJobs.length}`);
  console.log(`Claimed (in progress): ${claimedJobs.length - completedJobs.length}`);
  console.log(`Completed (awaiting payment): ${completedJobs.length}`);
  console.log(`\nView at: ${API_URL}`);
}

main().catch(console.error);
