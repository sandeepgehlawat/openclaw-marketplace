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

const jobs = [
  { title: 'Analyze DeFi protocols', description: 'Compare top 5 DeFi protocols by TVL and security', bounty: 0.12 },
  { title: 'Write Rust code review', description: 'Review 200 lines of Rust async code', bounty: 0.18 },
  { title: 'Summarize whitepaper', description: 'Create 500 word summary of Ethereum 2.0 specs', bounty: 0.08 },
  { title: 'Generate SQL queries', description: 'Write 10 optimized SQL queries for analytics', bounty: 0.15 },
  { title: 'Debug WebSocket issue', description: 'Fix connection dropping after 30 seconds', bounty: 0.25 },
  { title: 'Create API tests', description: 'Write integration tests for payment endpoints', bounty: 0.20 },
];

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

async function createJob(title: string, desc: string, bounty: number): Promise<{id: string, escrowTo: string}> {
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
  return { id: data.job.id, escrowTo: data.escrow.depositTo };
}

async function depositEscrow(jobId: string, txSig: string): Promise<boolean> {
  const res = await fetch(`${API_URL}/api/v1/jobs/${jobId}/deposit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ depositTxSig: txSig })
  });
  const data = await res.json();
  console.log(`  Deposit: ${data.success ? 'OK' : data.error}`);
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
  console.log('Creating and funding jobs on Railway...\n');

  const createdJobs: {id: string, title: string, bounty: number}[] = [];

  for (const job of jobs) {
    console.log(`Creating: ${job.title} (${job.bounty} USDC)`);
    const { id, escrowTo } = await createJob(job.title, job.description, job.bounty);
    console.log(`  Job ID: ${id}`);

    // Send USDC to escrow
    console.log(`  Sending ${job.bounty} USDC to escrow...`);
    const txSig = await sendUsdc(new PublicKey(escrowTo), job.bounty);
    console.log(`  TX: ${txSig.slice(0,20)}...`);

    // Verify deposit
    await depositEscrow(id, txSig);
    createdJobs.push({ id, title: job.title, bounty: job.bounty });

    await new Promise(r => setTimeout(r, 500));
  }

  console.log('\n--- Claiming 3 jobs ---');
  for (let i = 0; i < 3; i++) {
    const job = createdJobs[i];
    console.log(`Claiming: ${job.title}`);
    await claimJob(job.id);
  }

  console.log('\n--- Completing 2 jobs ---');
  const results = [
    'Analysis complete: Aave leads with $12B TVL, followed by Lido, MakerDAO, Uniswap, and Compound. Security audits verified for all.',
    'Code review done: Found 3 potential race conditions in async handlers. Recommended using Mutex for shared state. No critical issues.'
  ];

  for (let i = 0; i < 2; i++) {
    const job = createdJobs[i];
    console.log(`Completing: ${job.title}`);
    await completeJob(job.id, results[i]);
  }

  console.log('\n✓ Done! Check https://openclaw-marketplace-production.up.railway.app');
}

main().catch(console.error);
