// scripts/transferAuthority.js
const fs = require("fs");
const path = require("path");
const anchor = require("@coral-xyz/anchor");
const { Keypair, Connection, PublicKey } = require("@solana/web3.js");
const { TOKEN_PROGRAM_ID } = require("@solana/spl-token");
const idl = require("../target/idl/dlan_stake.json");

(async () => {
    // 1) Загружаем ваш ключ
    const secret = JSON.parse(
        fs.readFileSync(path.join(process.env.HOME, ".config/solana/id.json"), "utf8")
    );
    const keypair = Keypair.fromSecretKey(Uint8Array.from(secret));

    // 2) Настраиваем провайдера
    const connection = new Connection("https://api.devnet.solana.com", "processed");
    const wallet = new anchor.Wallet(keypair);
    const provider = new anchor.AnchorProvider(connection, wallet, {});
    anchor.setProvider(provider);

    // 3) Инстанцируем программу
    const program = new anchor.Program(idl, idl.address, provider);

    // 4) Рассчитываем PDA mint_authority
    const [mintAuthPDA] = PublicKey.findProgramAddressSync(
        [Buffer.from("mint-auth")],
        program.programId
    );

    // 5) Вызываем CPI-инструкцию, чтобы PDA отдал вам authority
    console.log("-> передаём право mint-authority …");
    const tx = await program.methods
        .setMintAuthority(wallet.publicKey)     // ваш pubkey
        .accounts({
            mint: new PublicKey("9v2hp9qPW9wHodX1y6dDzR5jrU3n1ToAxAtcZArY71FR"),
            mintAuthority: mintAuthPDA,
            tokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc();

    console.log("✅ Authority transferred, tx:", tx);
})();
