// scripts/create_vault_ata.mjs
import fs from "fs";
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from "@solana/spl-token";

// === НАСТРОЙКИ ===
const RPC =
  "https://frequent-thrumming-tent.solana-mainnet.quiknode.pro/50b053e4695fe25371395a9c52174462b48fb9a4/";
const PROGRAM_ID = new PublicKey("3hQsDEYknZmKKUBApAGtcGPy395ogJdiB8DCvMKh24K7");

// Мейннет-USDT (SPL Tether)
const USDT_MINT = new PublicKey(
  "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB"
);

// === грузим ключ плательщика (fee payer) ===
// Используется ваш стандартный CLI ключ: ~/.config/solana/id.json
const secretPath = process.env.HOME + "/.config/solana/id.json";
const secret = Uint8Array.from(JSON.parse(fs.readFileSync(secretPath, "utf8")));
const payer = Keypair.fromSecretKey(secret);

const connection = new Connection(RPC, "confirmed");

// PDA владельца хранилища
const [vaultAuthPda] = PublicKey.findProgramAddressSync(
  [Buffer.from("vault-auth")],
  PROGRAM_ID
);

console.log("Vault auth PDA:", vaultAuthPda.toBase58());
console.log("USDT mint     :", USDT_MINT.toBase58());

// === адрес будущего ATA (ВАЖНО: allowOwnerOffCurve = true для PDA) ===
const vaultUsdtAta = await getAssociatedTokenAddress(
  USDT_MINT,
  vaultAuthPda,
  true // allowOwnerOffCurve: владелец — PDA
);
console.log("Expected vault USDT ATA:", vaultUsdtAta.toBase58());

// Уже создан?
const exists = await connection.getAccountInfo(vaultUsdtAta);
if (exists) {
  console.log("✅ ATA уже существует.");
  process.exit(0);
}

// Инструкция создания ATA (payer = вы, owner = PDA, mint = USDT)
const ix = createAssociatedTokenAccountInstruction(
  payer.publicKey,
  vaultUsdtAta,
  vaultAuthPda,
  USDT_MINT,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID
);

const tx = new Transaction().add(ix);

const sig = await sendAndConfirmTransaction(connection, tx, [payer], {
  commitment: "confirmed",
});
console.log("✅ Создано. Tx:", sig);
