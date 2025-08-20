// pda.js
import { PublicKey } from "@solana/web3.js";

const PROGRAM_ID = new PublicKey("3hQsDEYknZmKKUBApAGtcGPy395ogJdiB8DCvMKh24K7");

const [mintAuth, bumpMint]  = PublicKey.findProgramAddressSync([Buffer.from("mint-auth")], PROGRAM_ID);
const [vaultAuth, bumpVault]= PublicKey.findProgramAddressSync([Buffer.from("vault-auth")], PROGRAM_ID);

console.log("mint-auth:", mintAuth.toBase58(), "bump:", bumpMint);
console.log("vault-auth:", vaultAuth.toBase58(), "bump:", bumpVault);
