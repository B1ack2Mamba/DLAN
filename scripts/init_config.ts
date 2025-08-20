import { AnchorProvider, Program, Idl, BN } from "@coral-xyz/anchor";
import { Connection, PublicKey, Keypair, SystemProgram, SYSVAR_RENT_PUBKEY, clusterApiUrl } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID } from "@solana/spl-token";
import idlJson from "../target/idl/dlan_stake.json";

const IDL = idlJson as unknown as Idl;
const PROGRAM_ID = new PublicKey("3hQsDEYknZmKKUBApAGtcGPy395ogJdiB8DCvMKh24K7");

// ⚙️ Заполни свои значения:
const ADMIN = new PublicKey("Gxovarj3kNDd6ks54KNXknRh1GP5ETaUdYGr1xgqeVNh");      // куда уходит SOL
const DLAN_MINT = new PublicKey("9v2hp9qPW9wHodX1y6dDzR5jrU3n1ToAxAtcZArY71FR");  // ваш DLAN mint
const USDT_MINT = new PublicKey("3pqJ783gQtGVvEwRYSzEx78FTDP6cAfMB9xZ2qBscpxS");  // ваш USDT mint
const VAULT_TOKEN = new PublicKey("AGmj155vzd5VcVRWkUzQJaParPArvtyShtyYozRWCWn7"); // ATA под PDA vault-auth (USDT)
const INVEST_FEE_RECIPIENT = new PublicKey("F5rP2d1tGcy2zv5bv3qdfj11GZNiC9ZVxMBFy7aaetzS");

// dlan_per_usd_per_day в единицах DLAN (decimals dlan). Например: 120 DLAN/день → 120 * 10^9
const DLAN_DECIMALS = 9;
const DENOM_DLAN_PER_USD_PER_DAY_UNITS = new BN(120).mul(new BN(10).pow(new BN(DLAN_DECIMALS)));

async function main() {
  // берём локальный keypair из Phantom через injected provider НЕЛЬЗЯ — используем файл кошелька:
  // для простоты можно загрузить keypair из env или из .json
  // здесь — через соланин default keypair (solana-keygen new / set)
  // Если удобнее — поставь @project-serum/anchor-cli и используй Anchor.wallet.
  // Ниже – вариант через Keypair.fromSecretKey(...) по необходимости.

  const conn = new Connection(clusterApiUrl("devnet"), "confirmed");

  // Используем системный Keypair по умолчанию (solana config get → keypair)
  // Либо подставь свой:
  // const wallet = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(require("fs").readFileSync("/path/to/your.json","utf8"))));
  // @ts-ignore
  const wallet = (await import("fs")).existsSync(process.env.HOME + "/.config/solana/id.json")
    ? Keypair.fromSecretKey(
        Uint8Array.from(
          JSON.parse((await import("fs")).readFileSync(process.env.HOME + "/.config/solana/id.json", "utf8"))
        )
      )
    : (() => {
        throw new Error("Укажи путь к кошельку в scripts/init_config.ts");
      })();

  const provider = new AnchorProvider(conn, {
    publicKey: wallet.publicKey,
    signAllTransactions: async (txs) => txs.map((tx) => { tx.partialSign(wallet); return tx; }),
    signTransaction: async (tx) => { tx.partialSign(wallet); return tx; },
  } as any, { commitment: "confirmed" });

    const program = new Program(IDL as Idl, provider);


  const [configPda] = PublicKey.findProgramAddressSync([Buffer.from("config")], PROGRAM_ID);
  const [mintAuth]  = PublicKey.findProgramAddressSync([Buffer.from("mint-auth")], PROGRAM_ID);
  const [vaultAuth] = PublicKey.findProgramAddressSync([Buffer.from("vault-auth")], PROGRAM_ID);

  console.log("config PDA:", configPda.toBase58());
  console.log("mint-auth :", mintAuth.toBase58());
  console.log("vault-auth:", vaultAuth.toBase58());

  // Если в программе метод называется иначе — подставь своё имя (initialize / initConfig / setup …)
  const sig = await (program.methods as any)
    .initConfig(DENOM_DLAN_PER_USD_PER_DAY_UNITS) // если нужны ещё аргументы — добавь
    .accounts({
      authority: wallet.publicKey,      // админ, кто инициализирует
      config: configPda,
      admin: ADMIN,
      dlanMint: DLAN_MINT,
      usdtMint: USDT_MINT,
      vaultToken: VAULT_TOKEN,
      vaultAuthority: vaultAuth,
      mintAuthority: mintAuth,
      systemProgram: SystemProgram.programId,
      tokenProgram: TOKEN_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      rent: SYSVAR_RENT_PUBKEY,
    })
    .rpc();

  console.log("init sig:", sig);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
