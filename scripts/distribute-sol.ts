import "dotenv/config";
import { config } from "dotenv";
import { Keypair, PublicKey, SystemProgram, Transaction, sendAndConfirmTransaction } from "@solana/web3.js";
import bs58 from "bs58";
import { existsSync } from "fs";
import { getConnection, getSolBalance } from "../src/solana/client.js";

// Load .env.local
if (existsSync(".env.local")) {
  config({ path: ".env.local" });
}

async function main() {
  console.log("Distributing SOL from Bot A to Bot B and Bot C...\n");

  const conn = getConnection();

  // Load Bot A (source)
  if (!process.env.BOT_A_SECRET_KEY) {
    console.error("BOT_A_SECRET_KEY not found in .env.local");
    process.exit(1);
  }
  const botA = Keypair.fromSecretKey(bs58.decode(process.env.BOT_A_SECRET_KEY));

  // Get recipient addresses
  const recipients = [
    { name: "Bot B", pubkey: process.env.BOT_B_PUBLIC_KEY },
    { name: "Bot C", pubkey: process.env.BOT_C_PUBLIC_KEY },
  ].filter((r) => r.pubkey);

  // Check Bot A balance
  const botABalance = await getSolBalance(botA.publicKey.toBase58());
  console.log(`Bot A balance: ${botABalance} SOL`);

  // Send 1 SOL to each recipient (keeping some for Bot A's fees)
  const amountToSend = 1.5; // 1.5 SOL each
  const lamports = amountToSend * 1e9;

  for (const recipient of recipients) {
    try {
      console.log(`\nSending ${amountToSend} SOL to ${recipient.name}...`);

      const tx = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: botA.publicKey,
          toPubkey: new PublicKey(recipient.pubkey!),
          lamports,
        })
      );

      const sig = await sendAndConfirmTransaction(conn, tx, [botA]);
      console.log(`✓ Sent! TX: ${sig}`);

      const balance = await getSolBalance(recipient.pubkey!);
      console.log(`  ${recipient.name} balance: ${balance} SOL`);
    } catch (error) {
      console.error(`✗ Failed to send to ${recipient.name}:`, error);
    }
  }

  // Final balances
  console.log("\n─── Final Balances ───");
  console.log(`Bot A: ${await getSolBalance(botA.publicKey.toBase58())} SOL`);
  for (const recipient of recipients) {
    console.log(`${recipient.name}: ${await getSolBalance(recipient.pubkey!)} SOL`);
  }

  console.log("\n✓ Done! Now run 'npm run airdrop-usdc'");
}

main().catch(console.error);
