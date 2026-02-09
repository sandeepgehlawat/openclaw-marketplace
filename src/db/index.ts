import pg from "pg";
const { Pool } = pg;

// Railway provides DATABASE_URL automatically when you add PostgreSQL
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes("railway")
    ? { rejectUnauthorized: false }
    : undefined,
});

// Initialize database schema
export async function initDatabase(): Promise<void> {
  const client = await pool.connect();

  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS jobs (
        id VARCHAR(20) PRIMARY KEY,
        title VARCHAR(255) NOT NULL,
        description TEXT NOT NULL,
        bounty_usdc DECIMAL(18, 6) NOT NULL,
        bounty_atomic BIGINT NOT NULL,
        requester_wallet VARCHAR(44) NOT NULL,
        worker_wallet VARCHAR(44),
        status VARCHAR(20) NOT NULL DEFAULT 'pending_deposit',
        result TEXT,
        deposit_tx_sig VARCHAR(100),
        payment_tx_sig VARCHAR(100),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        claimed_at TIMESTAMPTZ,
        completed_at TIMESTAMPTZ,
        paid_at TIMESTAMPTZ
      );

      CREATE TABLE IF NOT EXISTS escrow_records (
        job_id VARCHAR(20) PRIMARY KEY REFERENCES jobs(id),
        requester_wallet VARCHAR(44) NOT NULL,
        worker_wallet VARCHAR(44),
        amount_atomic BIGINT NOT NULL,
        deposit_tx_sig VARCHAR(100) NOT NULL,
        deposit_verified_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        status VARCHAR(20) NOT NULL DEFAULT 'held',
        release_tx_sig VARCHAR(100),
        released_at TIMESTAMPTZ
      );

      CREATE TABLE IF NOT EXISTS used_deposit_txs (
        tx_sig VARCHAR(100) PRIMARY KEY,
        used_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
      CREATE INDEX IF NOT EXISTS idx_jobs_requester ON jobs(requester_wallet);
      CREATE INDEX IF NOT EXISTS idx_jobs_worker ON jobs(worker_wallet);
    `);

    console.log("Database schema initialized");
  } finally {
    client.release();
  }
}

// Export pool for queries
export { pool };

// Helper for single queries
export async function query<T = any>(text: string, params?: any[]): Promise<T[]> {
  const result = await pool.query(text, params);
  return result.rows;
}

// Helper for single row
export async function queryOne<T = any>(text: string, params?: any[]): Promise<T | null> {
  const rows = await query<T>(text, params);
  return rows[0] || null;
}

// Check if database is connected
export async function checkConnection(): Promise<boolean> {
  try {
    await pool.query("SELECT 1");
    return true;
  } catch {
    return false;
  }
}
