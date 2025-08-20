import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { getOrCreateAssociatedTokenAccount } from "@solana/spl-token";
import fs from "fs";

// Параметры RPC Solana
const RPC = "https://api.mainnet-beta.solana.com";

// Путь к файлу с вашим секретом Solana (id.json)
const secret = JSON.parse(fs.readFileSync(process.env.HOME + "/.config/solana/id.json", "utf8"));
const payer = Keypair.fromSecretKey(Uint8Array.from(secret));

// Убедитесь, что указанные публичные ключи правильные (без пробелов, переносов и лишних символов)
const USDT_MINT = new PublicKey("Es9vMFrzaCERZ8k1M2uC6tq9DP1w7DNR3iC3f7h4E9");
const VAULT_AUTH_PDA = new PublicKey("ByG2RboeJD4hTxZ8MGHMfmsdWbyvVFNh1jrPL27suoyc");

(async () => {
    const conn = new Connection(RPC, "confirmed");

    // Получаем или создаем ATA (associated token account) для USDT с владельцем VAULT_AUTH_PDA
    const ata = await getOrCreateAssociatedTokenAccount(
        conn,
        payer,               // кто платит комиссии
        USDT_MINT,           // токен (USDT)
        VAULT_AUTH_PDA,      // владельцем будет VAULT_AUTH_PDA
        true                 // allowOwnerOffCurve
    );
    console.log("Vault USDT ATA:", ata.address.toBase58());
})();
