import { Request, Response, NextFunction } from "express";

// Rate limiting store (in-memory)
const rateLimitStore = new Map<string, { count: number; resetAt: number }>();

// Configuration
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute
const RATE_LIMIT_MAX_REQUESTS = 100; // 100 requests per minute

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
        message: `Rate limit exceeded. Try again in ${Math.ceil((record.resetAt - now) / 1000)} seconds`,
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
 * Validate Solana signature (for authenticated endpoints)
 * Bots can sign a message with their private key to prove ownership
 */
export interface SignedRequest {
  wallet: string;
  signature: string;
  message: string;
  timestamp: number;
}

export function validateSignature(signed: SignedRequest): boolean {
  // Check timestamp is recent (within 5 minutes)
  const now = Date.now();
  if (Math.abs(now - signed.timestamp) > 5 * 60 * 1000) {
    return false;
  }

  // In production, verify the signature using @solana/web3.js
  // const verified = nacl.sign.detached.verify(
  //   Buffer.from(signed.message),
  //   Buffer.from(signed.signature, 'base64'),
  //   new PublicKey(signed.wallet).toBytes()
  // );

  return true; // Placeholder - implement full verification as needed
}

/**
 * Transaction replay protection
 * Prevents the same transaction from being used twice
 */
const processedTransactions = new Set<string>();
const TX_EXPIRY_MS = 24 * 60 * 60 * 1000; // 24 hours

export function isTransactionProcessed(txSig: string): boolean {
  return processedTransactions.has(txSig);
}

export function markTransactionProcessed(txSig: string): void {
  processedTransactions.add(txSig);

  // Clean up old transactions periodically
  setTimeout(() => {
    processedTransactions.delete(txSig);
  }, TX_EXPIRY_MS);
}

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
