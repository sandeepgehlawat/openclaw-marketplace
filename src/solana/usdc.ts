import {
  getAssociatedTokenAddress,
  getOrCreateAssociatedTokenAccount,
  transfer,
  getAccount,
  TokenAccountNotFoundError,
} from "@solana/spl-token";
import {
  PublicKey,
  Keypair,
  Transaction,
  SystemProgram,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import { getConnection } from "./client.js";
import { USDC_MINT_DEVNET, USDC_DECIMALS, atomicToUsdc } from "../config/constants.js";

// Get USDC balance for an address
export async function getUsdcBalance(address: string): Promise<number> {
  const conn = getConnection();
  const owner = new PublicKey(address);

  try {
    const ata = await getAssociatedTokenAddress(USDC_MINT_DEVNET, owner);
    const account = await getAccount(conn, ata);
    return atomicToUsdc(account.amount);
  } catch (error) {
    if (error instanceof TokenAccountNotFoundError) {
      return 0;
    }
    throw error;
  }
}

// Get or create USDC token account
export async function ensureUsdcAccount(
  payer: Keypair,
  owner: PublicKey
): Promise<PublicKey> {
  const conn = getConnection();
  const account = await getOrCreateAssociatedTokenAccount(
    conn,
    payer,
    USDC_MINT_DEVNET,
    owner
  );
  return account.address;
}

// Transfer USDC between accounts
export async function transferUsdc(
  sender: Keypair,
  recipientAddress: string,
  amountAtomic: bigint
): Promise<string> {
  const conn = getConnection();
  const recipient = new PublicKey(recipientAddress);

  // Get sender's ATA
  const senderAta = await getAssociatedTokenAddress(
    USDC_MINT_DEVNET,
    sender.publicKey
  );

  // Ensure recipient has an ATA (create if needed)
  const recipientAta = await ensureUsdcAccount(sender, recipient);

  // Transfer
  const signature = await transfer(
    conn,
    sender,
    senderAta,
    recipientAta,
    sender,
    amountAtomic
  );

  return signature;
}

// Verify a USDC transfer transaction
export async function verifyUsdcTransfer(
  signature: string,
  expectedSender: string,
  expectedRecipient: string,
  expectedAmountAtomic: bigint
): Promise<boolean> {
  const conn = getConnection();

  try {
    const tx = await conn.getTransaction(signature, {
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0,
    });

    if (!tx || !tx.meta) {
      return false;
    }

    // Check for token balance changes
    const preBalances = tx.meta.preTokenBalances || [];
    const postBalances = tx.meta.postTokenBalances || [];

    // Find USDC transfers
    for (const post of postBalances) {
      if (post.mint !== USDC_MINT_DEVNET.toBase58()) continue;

      const pre = preBalances.find(
        (p) => p.accountIndex === post.accountIndex && p.mint === post.mint
      );

      if (!pre) continue;

      const preAmount = BigInt(pre.uiTokenAmount.amount);
      const postAmount = BigInt(post.uiTokenAmount.amount);
      const diff = postAmount - preAmount;

      // Check if this is the expected recipient receiving the expected amount
      if (
        post.owner === expectedRecipient &&
        diff >= expectedAmountAtomic
      ) {
        return true;
      }
    }

    return false;
  } catch (error) {
    console.error("Error verifying transfer:", error);
    return false;
  }
}

// Build an unsigned USDC transfer transaction
export async function buildUsdcTransferTx(
  senderPubkey: PublicKey,
  recipientAddress: string,
  amountAtomic: bigint
): Promise<Transaction> {
  const conn = getConnection();
  const recipient = new PublicKey(recipientAddress);

  // Get ATAs
  const senderAta = await getAssociatedTokenAddress(USDC_MINT_DEVNET, senderPubkey);
  const recipientAta = await getAssociatedTokenAddress(USDC_MINT_DEVNET, recipient);

  // Build transfer instruction
  const { createTransferInstruction } = await import("@solana/spl-token");

  const transferIx = createTransferInstruction(
    senderAta,
    recipientAta,
    senderPubkey,
    amountAtomic
  );

  const tx = new Transaction().add(transferIx);

  // Get recent blockhash
  const { blockhash } = await conn.getLatestBlockhash();
  tx.recentBlockhash = blockhash;
  tx.feePayer = senderPubkey;

  return tx;
}
