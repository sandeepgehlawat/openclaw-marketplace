import "dotenv/config";
import { config } from "dotenv";
import { Keypair, PublicKey } from "@solana/web3.js";
import {
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
} from "@solana/spl-token";
import bs58 from "bs58";
import { getConnection, getSolBalance } from "../src/solana/client.js";
import { USDC_DECIMALS } from "../src/config/constants.js";
import { existsSync, readFileSync, writeFileSync } from "fs";

// Load .env.local if it exists
if (existsSync(".env.local")) {
  config({ path: ".env.local" });
}

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  console.log("Setting up devnet USDC for testing...\n");

  const conn = getConnection();

  // Get wallet keys from environment
  const wallets = [
    { name: "Bot A", pubkey: process.env.BOT_A_PUBLIC_KEY, secret: process.env.BOT_A_SECRET_KEY },
    { name: "Bot B", pubkey: process.env.BOT_B_PUBLIC_KEY, secret: process.env.BOT_B_SECRET_KEY },
    { name: "Bot C", pubkey: process.env.BOT_C_PUBLIC_KEY, secret: process.env.BOT_C_SECRET_KEY },
  ].filter((w) => w.pubkey && w.secret);

  if (wallets.length === 0) {
    console.error("No wallets found! Run 'npm run setup-wallets' first.");
    process.exit(1);
  }

  // Check if wallets have SOL
  console.log("Checking wallet SOL balances...\n");
  let allFunded = true;
  for (const wallet of wallets) {
    const balance = await getSolBalance(wallet.pubkey!);
    console.log(`  ${wallet.name}: ${balance} SOL`);
    if (balance < 0.01) {
      allFunded = false;
    }
  }

  if (!allFunded) {
    console.log(`
╔════════════════════════════════════════════════════════════════════════╗
║  Some wallets need SOL for transaction fees!                           ║
║                                                                        ║
║  Visit https://faucet.solana.com and request SOL for each wallet:      ║
╠════════════════════════════════════════════════════════════════════════╣`);
    for (const wallet of wallets) {
      console.log(`║  ${wallet.name}: ${wallet.pubkey}`);
    }
    console.log(`╚════════════════════════════════════════════════════════════════════════╝

After funding, run this script again.
`);
    process.exit(1);
  }

  console.log("\n✓ All wallets have SOL\n");

  // Use Bot A as the mint authority (it has SOL)
  const mintAuthority = Keypair.fromSecretKey(bs58.decode(wallets[0].secret!));
  console.log("Using Bot A as mint authority:", mintAuthority.publicKey.toBase58());

  // Create a test USDC mint
  console.log("Creating test USDC mint...");
  const usdcMint = await createMint(
    conn,
    mintAuthority,
    mintAuthority.publicKey,
    mintAuthority.publicKey,
    USDC_DECIMALS
  );
  console.log("✓ Test USDC Mint:", usdcMint.toBase58(), "\n");

  // Mint USDC to each wallet
  const amountToMint = 100; // 100 USDC each
  const atomicAmount = BigInt(amountToMint * 10 ** USDC_DECIMALS);

  console.log(`Minting ${amountToMint} USDC to each wallet...\n`);

  for (const wallet of wallets) {
    try {
      const owner = new PublicKey(wallet.pubkey!);

      // Get or create associated token account
      const ata = await getOrCreateAssociatedTokenAccount(
        conn,
        mintAuthority,
        usdcMint,
        owner
      );

      // Mint tokens
      await mintTo(conn, mintAuthority, usdcMint, ata.address, mintAuthority, atomicAmount);

      console.log(`✓ ${wallet.name}:`);
      console.log(`    Wallet: ${wallet.pubkey}`);
      console.log(`    Token Account: ${ata.address.toBase58()}`);
      console.log(`    Balance: ${amountToMint} USDC\n`);

      await sleep(500); // Small delay between operations
    } catch (error) {
      console.error(`✗ Failed for ${wallet.name}:`, error);
    }
  }

  // Update .env.local with the test USDC mint
  const envPath = ".env.local";
  let envContent = existsSync(envPath) ? readFileSync(envPath, "utf-8") : "";

  // Remove old USDC_MINT if present
  envContent = envContent.replace(/\nUSDC_MINT=.*\n?/g, "\n");
  envContent = envContent.replace(/\nMINT_AUTHORITY_SECRET_KEY=.*\n?/g, "\n");

  // Add new mint info
  envContent += `
# Test USDC Mint (created by airdrop-usdc.ts)
USDC_MINT=${usdcMint.toBase58()}
`;

  writeFileSync(envPath, envContent.trim() + "\n");

  console.log("✓ Updated .env.local with test USDC mint\n");
  console.log("Ready for testing! Run 'npm run dev' to start the server.");
}

main().catch(console.error);
