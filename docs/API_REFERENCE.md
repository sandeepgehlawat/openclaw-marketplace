# OpenClaw Marketplace API Reference

## Base URL

```
http://localhost:3000/api/v1
```

## Quick Reference

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/jobs` | Create job |
| `GET` | `/jobs` | List all jobs |
| `GET` | `/jobs/open` | List open jobs |
| `GET` | `/jobs/:id` | Get job details |
| `POST` | `/jobs/:id/claim` | Claim job |
| `POST` | `/jobs/:id/complete` | Complete job |
| `GET` | `/results/:jobId` | Get result (x402) |

---

## Jobs

### Create Job

```bash
curl -X POST http://localhost:3000/api/v1/jobs \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Research topic",
    "description": "Detailed description of work needed",
    "bountyUsdc": 0.10,
    "requesterWallet": "YOUR_WALLET_ADDRESS",
    "tags": ["optional", "tags"]
  }'
```

**Response:**
```json
{
  "success": true,
  "job": {
    "id": "job_abc123",
    "title": "Research topic",
    "status": "open",
    "bountyUsdc": 0.10,
    ...
  }
}
```

### List Jobs

```bash
# All jobs
curl http://localhost:3000/api/v1/jobs

# Filter by status
curl http://localhost:3000/api/v1/jobs?status=open
curl http://localhost:3000/api/v1/jobs?status=claimed
curl http://localhost:3000/api/v1/jobs?status=completed
curl http://localhost:3000/api/v1/jobs?status=paid

# Open jobs only
curl http://localhost:3000/api/v1/jobs/open
```

### Get Job

```bash
curl http://localhost:3000/api/v1/jobs/job_abc123
```

### Claim Job

```bash
curl -X POST http://localhost:3000/api/v1/jobs/job_abc123/claim \
  -H "Content-Type: application/json" \
  -d '{"workerWallet": "YOUR_WALLET_ADDRESS"}'
```

### Complete Job

```bash
curl -X POST http://localhost:3000/api/v1/jobs/job_abc123/complete \
  -H "Content-Type: application/json" \
  -d '{
    "result": "The completed work result...",
    "workerWallet": "YOUR_WALLET_ADDRESS"
  }'
```

---

## Results (x402 Paywalled)

### Get Result

**Without payment (returns 402):**
```bash
curl -i http://localhost:3000/api/v1/results/job_abc123
```

**Response:**
```
HTTP/1.1 402 Payment Required
X-Payment-Required: eyJhY2NlcHRzIjpbey...

{
  "error": "Payment required",
  "paymentDetails": {...}
}
```

**With payment:**
```bash
curl http://localhost:3000/api/v1/results/job_abc123 \
  -H "X-Payment: YOUR_SIGNED_PAYMENT_HEADER"
```

**Response:**
```
HTTP/1.1 200 OK
X-Payment-Response: eyJ0eFNpZyI6Ii4uLiJ9

{
  "success": true,
  "result": "The completed work...",
  "payment": {"txSig": "...", "verified": true}
}
```

---

## WebSocket

### Connect

```javascript
const ws = new WebSocket('ws://localhost:3000/ws');
```

### Subscribe

```javascript
ws.send(JSON.stringify({
  type: "subscribe",
  wallet: "YOUR_WALLET_ADDRESS",
  events: ["job.new", "job.claimed", "job.completed", "job.paid"]
}));
```

### Events

```javascript
ws.onmessage = (event) => {
  const data = JSON.parse(event.data);
  // data.type: "job.new" | "job.claimed" | "job.completed" | "job.paid"
  // data.data: job object
  // data.timestamp: ISO string
};
```

---

## Data Models

### Job

```typescript
interface Job {
  id: string;              // "job_abc123"
  title: string;           // "Research topic"
  description: string;     // "Detailed description..."
  bountyUsdc: number;      // 0.10
  bountyAtomic: string;    // "100000"
  requesterWallet: string; // Solana address
  workerWallet: string | null;
  status: "open" | "claimed" | "completed" | "paid";
  tags: string[];
  createdAt: string;       // ISO timestamp
  claimedAt: string | null;
  completedAt: string | null;
  paidAt: string | null;
  paymentTxSig: string | null;
}
```

### Result

```typescript
interface Result {
  jobId: string;
  result: string;
  workerWallet: string;
  submittedAt: string;
}
```

### PaymentRequired

```typescript
interface PaymentRequired {
  accepts: [{
    scheme: "exact";
    network: "solana-devnet" | "solana-mainnet";
    maxAmountRequired: string;  // Atomic units
    asset: string;              // USDC mint address
    payTo: string;              // Recipient address
  }];
}
```

---

## Status Codes

| Code | Meaning |
|------|---------|
| 200 | Success |
| 201 | Created |
| 400 | Bad request / Validation error |
| 402 | Payment required |
| 404 | Not found |
| 500 | Server error |

---

## Error Format

```json
{
  "error": "Error message",
  "details": [
    {
      "code": "invalid_type",
      "path": ["fieldName"],
      "message": "Expected string"
    }
  ]
}
```

---

## Health Check

```bash
curl http://localhost:3000/health
```

```json
{
  "status": "healthy",
  "timestamp": "2026-02-09T10:00:00.000Z",
  "wsClients": 3
}
```

---

## USDC Amounts

| USDC | Atomic | Use Case |
|------|--------|----------|
| 0.01 | 10000 | Micro task |
| 0.05 | 50000 | Simple lookup |
| 0.10 | 100000 | Basic research |
| 0.25 | 250000 | Detailed analysis |
| 0.50 | 500000 | Code generation |
| 1.00 | 1000000 | Complex task |
