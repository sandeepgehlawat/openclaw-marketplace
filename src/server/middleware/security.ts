import { Request, Response, NextFunction } from "express";

// Rate limiting store (in-memory)
const rateLimitStore = new Map<string, { count: number; resetAt: number }>();

// Configuration
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute
const RATE_LIMIT_MAX_REQUESTS = 100; // 100 requests per minute
const RATE_LIMIT_CLEANUP_INTERVAL = 5 * 60 * 1000; // Clean every 5 minutes

// Periodic cleanup of expired rate limit records
setInterval(() => {
  const now = Date.now();
  for (const [ip, record] of rateLimitStore) {
    if (now > record.resetAt) {
      rateLimitStore.delete(ip);
    }
  }
}, RATE_LIMIT_CLEANUP_INTERVAL);

/**
 * Rate limiting middleware
 * Prevents abuse by limiting requests per IP
 */
export function rateLimit() {
  return (req: Request, res: Response, next: NextFunction) => {
    const ip = req.ip || req.socket.remoteAddress || "unknown";
    const now = Date.now();

    let record = rateLimitStore.get(ip);

    if (!record || now > record.resetAt) {
      record = { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS };
      rateLimitStore.set(ip, record);
    } else {
      record.count++;
    }

    // Set rate limit headers
    res.setHeader("X-RateLimit-Limit", RATE_LIMIT_MAX_REQUESTS);
    res.setHeader("X-RateLimit-Remaining", Math.max(0, RATE_LIMIT_MAX_REQUESTS - record.count));
    res.setHeader("X-RateLimit-Reset", record.resetAt);

    if (record.count > RATE_LIMIT_MAX_REQUESTS) {
      return res.status(429).json({
        error: "Too many requests",
        retryAfter: Math.ceil((record.resetAt - now) / 1000),
      });
    }

    next();
  };
}

/**
 * Request ID middleware
 * Adds unique ID to each request for tracing
 */
export function requestId() {
  return (req: Request, res: Response, next: NextFunction) => {
    const id = `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    req.headers["x-request-id"] = id;
    res.setHeader("X-Request-ID", id);
    next();
  };
}

/**
 * Security headers middleware
 */
export function securityHeaders() {
  return (req: Request, res: Response, next: NextFunction) => {
    // Prevent clickjacking
    res.setHeader("X-Frame-Options", "DENY");
    // Prevent MIME type sniffing
    res.setHeader("X-Content-Type-Options", "nosniff");
    // XSS protection
    res.setHeader("X-XSS-Protection", "1; mode=block");
    // Referrer policy
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");

    next();
  };
}

/**
 * Solana signature validation types
 * NOTE: Full signature verification not implemented in this version
 * Payment verification relies on on-chain transaction verification instead
 */
export interface SignedRequest {
  wallet: string;
  signature: string;
  message: string;
  timestamp: number;
}

// Signature validation is NOT used - payment is verified on-chain
// Keeping interface for future wallet authentication if needed

/**
 * Transaction replay protection
 * Prevents the same transaction from being used twice
 * Uses atomic check-and-set to prevent race conditions
 */
const processedTransactions = new Set<string>();
const txTimestamps = new Map<string, number>();
const TX_EXPIRY_MS = 24 * 60 * 60 * 1000; // 24 hours
const CLEANUP_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

// Atomic check-and-mark operation
// Returns true if transaction was already processed, false if newly marked
export function checkAndMarkTransaction(txSig: string): { alreadyProcessed: boolean } {
  if (processedTransactions.has(txSig)) {
    return { alreadyProcessed: true };
  }
  // Atomically add (JavaScript is single-threaded, so this is safe)
  processedTransactions.add(txSig);
  txTimestamps.set(txSig, Date.now());
  return { alreadyProcessed: false };
}

// Legacy functions for backward compatibility
export function isTransactionProcessed(txSig: string): boolean {
  return processedTransactions.has(txSig);
}

export function markTransactionProcessed(txSig: string): void {
  processedTransactions.add(txSig);
  txTimestamps.set(txSig, Date.now());
}

// Periodic cleanup of expired transactions
setInterval(() => {
  const now = Date.now();
  for (const [txSig, timestamp] of txTimestamps) {
    if (now - timestamp > TX_EXPIRY_MS) {
      processedTransactions.delete(txSig);
      txTimestamps.delete(txSig);
    }
  }
}, CLEANUP_INTERVAL_MS);

/**
 * Sanitize user input
 */
export function sanitizeString(input: string): string {
  return input
    .trim()
    .replace(/[<>]/g, "") // Remove potential HTML
    .slice(0, 10000); // Limit length
}

/**
 * Log security events
 */
export function logSecurityEvent(
  event: string,
  details: Record<string, unknown>
): void {
  console.log(
    JSON.stringify({
      type: "security",
      event,
      timestamp: new Date().toISOString(),
      ...details,
    })
  );
}
