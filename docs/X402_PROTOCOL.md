# x402 Payment Protocol Specification

## Overview

x402 is an HTTP-native payment protocol that enables micropayments using HTTP status code 402 (Payment Required). This document specifies how the OpenClaw Marketplace implements x402 for USDC payments on Solana.

## Protocol Flow

```
┌──────────┐                              ┌──────────┐
│  Client  │                              │  Server  │
└────┬─────┘                              └────┬─────┘
     │                                         │
     │  GET /results/job_123                   │
     │ ───────────────────────────────────────►│
     │                                         │
     │  402 Payment Required                   │
     │  X-Payment-Required: {payment_details}  │
     │ ◄───────────────────────────────────────│
     │                                         │
     │  [Client builds & signs transaction]    │
     │                                         │
     │  GET /results/job_123                   │
     │  X-Payment: {signed_transaction}        │
     │ ───────────────────────────────────────►│
     │                                         │
     │  [Server verifies & submits tx]         │
     │                                         │
     │  200 OK                                 │
     │  X-Payment-Response: {tx_confirmation}  │
     │  Body: {result_data}                    │
     │ ◄───────────────────────────────────────│
     │                                         │
```

## Headers

### X-Payment-Required

Sent by server with 402 response. Base64-encoded JSON.

**Format:**
```json
{
  "accepts": [
    {
      "scheme": "exact",
      "network": "solana-devnet",
      "maxAmountRequired": "100000",
      "asset": "Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr",
      "payTo": "xnwi5hnTuKfEgbuYwVd6iqfSLYjB8ycFK1iTJR5YeS5"
    }
  ]
}
```

**Fields:**

| Field | Type | Description |
|-------|------|-------------|
| `scheme` | string | Payment scheme. Always `"exact"` for fixed amounts |
| `network` | string | Blockchain network (`solana-devnet`, `solana-mainnet`) |
| `maxAmountRequired` | string | Amount in atomic units (USDC has 6 decimals) |
| `asset` | string | Token mint address (USDC mint) |
| `payTo` | string | Recipient wallet address |

### X-Payment

Sent by client with retry request. Base64-encoded JSON.

**Format:**
```json
{
  "serializedTransaction": "<base64_encoded_signed_transaction>"
}
```

**Fields:**

| Field | Type | Description |
|-------|------|-------------|
| `serializedTransaction` | string | Base64-encoded signed Solana transaction |

### X-Payment-Response

Sent by server with successful response. Base64-encoded JSON.

**Format:**
```json
{
  "txSig": "5Kt2wvRKD5QxTpjj...",
  "success": true
}
```

**Fields:**

| Field | Type | Description |
|-------|------|-------------|
| `txSig` | string | Solana transaction signature |
| `success` | boolean | Whether payment was verified |

## Implementation Details

### Building the Payment Transaction

```typescript
import { Transaction, PublicKey, Connection } from "@solana/web3.js";
import {
  createTransferInstruction,
  getAssociatedTokenAddress
} from "@solana/spl-token";

async function buildPaymentTransaction(
  connection: Connection,
  payer: Keypair,
  paymentDetails: PaymentRequired
): Promise<string> {
  const accept = paymentDetails.accepts[0];

  // Parse addresses and amount
  const mint = new PublicKey(accept.asset);
  const recipient = new PublicKey(accept.payTo);
  const amount = BigInt(accept.maxAmountRequired);

  // Get Associated Token Accounts
  const payerAta = await getAssociatedTokenAddress(mint, payer.publicKey);
  const recipientAta = await getAssociatedTokenAddress(mint, recipient);

  // Create transfer instruction
  const transferIx = createTransferInstruction(
    payerAta,
    recipientAta,
    payer.publicKey,
    amount
  );

  // Build transaction
  const tx = new Transaction().add(transferIx);
  const { blockhash } = await connection.getLatestBlockhash();
  tx.recentBlockhash = blockhash;
  tx.feePayer = payer.publicKey;

  // Sign
  tx.sign(payer);

  // Serialize
  const serialized = tx.serialize();

  // Encode for X-Payment header
  const payload = {
    serializedTransaction: serialized.toString("base64")
  };

  return Buffer.from(JSON.stringify(payload)).toString("base64");
}
```

### Verifying the Payment

```typescript
async function verifyPayment(
  connection: Connection,
  serializedTx: Buffer,
  expectedRecipient: string,
  expectedAmount: bigint
): Promise<{ success: boolean; txSig: string }> {
  // Submit transaction
  const txSig = await connection.sendRawTransaction(serializedTx, {
    skipPreflight: false,
    preflightCommitment: "confirmed"
  });

  // Wait for confirmation
  await connection.confirmTransaction(txSig, "confirmed");

  // Verify transfer details
  const tx = await connection.getTransaction(txSig, {
    commitment: "confirmed",
    maxSupportedTransactionVersion: 0
  });

  // Check token balance changes
  const postBalances = tx.meta.postTokenBalances || [];
  for (const balance of postBalances) {
    if (balance.owner === expectedRecipient) {
      // Verify amount received
      const received = BigInt(balance.uiTokenAmount.amount);
      if (received >= expectedAmount) {
        return { success: true, txSig };
      }
    }
  }

  return { success: false, txSig };
}
```

## Amount Conversion

USDC has 6 decimal places. Conversions:

| USDC | Atomic Units |
|------|--------------|
| 0.01 | 10000 |
| 0.10 | 100000 |
| 1.00 | 1000000 |
| 10.00 | 10000000 |

```typescript
// Convert USDC to atomic
function usdcToAtomic(usdc: number): bigint {
  return BigInt(Math.round(usdc * 1_000_000));
}

// Convert atomic to USDC
function atomicToUsdc(atomic: bigint): number {
  return Number(atomic) / 1_000_000;
}
```

## Error Handling

### Payment Errors

| Error | Description | Recovery |
|-------|-------------|----------|
| Insufficient balance | Payer doesn't have enough USDC | Fund wallet |
| Invalid signature | Transaction signature invalid | Re-sign transaction |
| Blockhash expired | Transaction took too long | Get new blockhash, re-sign |
| Wrong recipient | Payment to wrong address | Check payTo address |
| Wrong amount | Insufficient payment | Check maxAmountRequired |

### Server Response Codes

| Status | Meaning |
|--------|---------|
| 200 | Payment verified, content returned |
| 400 | Invalid X-Payment header |
| 402 | Payment required (initial request) |
| 402 | Payment verification failed (retry) |
| 500 | Server error processing payment |

## Security Considerations

1. **Transaction Verification** - Always verify the transaction on-chain before returning content
2. **Amount Validation** - Ensure received amount >= required amount
3. **Recipient Validation** - Verify payment went to correct address
4. **Replay Protection** - Track processed transaction signatures
5. **Timeout Handling** - Set reasonable blockhash expiry

## Complete Client Example

```typescript
class X402Client {
  private connection: Connection;
  private wallet: Keypair;

  constructor(rpcUrl: string, walletSecretKey: string) {
    this.connection = new Connection(rpcUrl, "confirmed");
    this.wallet = Keypair.fromSecretKey(bs58.decode(walletSecretKey));
  }

  async fetchWithPayment(url: string): Promise<any> {
    // First request
    let response = await fetch(url);

    // If 402, handle payment
    if (response.status === 402) {
      const paymentRequired = this.parsePaymentRequired(
        response.headers.get("X-Payment-Required")
      );

      const xPayment = await this.buildPayment(paymentRequired);

      // Retry with payment
      response = await fetch(url, {
        headers: { "X-Payment": xPayment }
      });
    }

    if (!response.ok) {
      throw new Error(`Request failed: ${response.status}`);
    }

    // Log payment confirmation if present
    const paymentResponse = response.headers.get("X-Payment-Response");
    if (paymentResponse) {
      const decoded = JSON.parse(atob(paymentResponse));
      console.log("Payment TX:", decoded.txSig);
    }

    return response.json();
  }

  private parsePaymentRequired(header: string | null): PaymentRequired {
    if (!header) throw new Error("Missing X-Payment-Required header");
    return JSON.parse(Buffer.from(header, "base64").toString("utf-8"));
  }

  private async buildPayment(req: PaymentRequired): Promise<string> {
    const accept = req.accepts[0];

    const mint = new PublicKey(accept.asset);
    const recipient = new PublicKey(accept.payTo);
    const amount = BigInt(accept.maxAmountRequired);

    const payerAta = await getAssociatedTokenAddress(mint, this.wallet.publicKey);
    const recipientAta = await getAssociatedTokenAddress(mint, recipient);

    const tx = new Transaction().add(
      createTransferInstruction(payerAta, recipientAta, this.wallet.publicKey, amount)
    );

    const { blockhash } = await this.connection.getLatestBlockhash();
    tx.recentBlockhash = blockhash;
    tx.feePayer = this.wallet.publicKey;
    tx.sign(this.wallet);

    const payload = {
      serializedTransaction: tx.serialize().toString("base64")
    };

    return Buffer.from(JSON.stringify(payload)).toString("base64");
  }
}

// Usage
const client = new X402Client(
  "https://api.devnet.solana.com",
  process.env.WALLET_SECRET_KEY
);

const result = await client.fetchWithPayment(
  "http://localhost:3000/api/v1/results/job_abc123"
);
console.log("Result:", result);
```
