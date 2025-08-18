import { useState, useCallback, useEffect, useMemo } from "react";
import { AnchorProvider, Program, Idl, BN } from "@coral-xyz/anchor";
import {
    Connection,
    PublicKey,
    SystemProgram,
    clusterApiUrl,
    SYSVAR_RENT_PUBKEY,
} from "@solana/web3.js";
import {
    getAssociatedTokenAddress,
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID,
    getMint,
} from "@solana/spl-token";
import idlJson from "../target/idl/dlan_stake.json";

// ---- Program / Mints ----
const IDL = idlJson as unknown as Idl;
const PROGRAM_ID = new PublicKey("3hQsDEYknZmKKUBApAGtcGPy395ogJdiB8DCvMKh24K7");

const DLAN_MINT = new PublicKey("9v2hp9qPW9wHodX1y6dDzR5jrU3n1ToAxAtcZArY71FR"); // ваш DLAN
const USDT_MINT = new PublicKey("3pqJ783gQtGVvEwRYSzEx78FTDP6cAfMB9xZ2qBscpxS"); // тестовый USDT

// Админ — сюда утекают SOL при стейке
const ADMIN_SOL_WALLET = new PublicKey("Gxovarj3kNDd6ks54KNXknRh1GP5ETaUdYGr1xgqeVNh");

// Vault под USDT (владелец — PDA vault-auth)
const VAULT_AUTHORITY_PDA = new PublicKey("ByG2RboeJD4hTxZ8MGHMfmsdWbyvVFNh1jrPL27suoyc");
const VAULT_USDT_ATA = new PublicKey("AGmj155vzd5VcVRWkUzQJaParPArvtyShtyYozRWCWn7");

// Jupiter mints (mainnet constants; для QUOTE это ок — мы их используем только как прайс-сорс)
const WSOL = "So11111111111111111111111111111111111111112";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

// types for vip.json
type VipTier = { wallet: string; buttons: number[]; fee_recipient?: string };
type VipConfig = {
    invest_usd_per_dlan_rule: { dlan_per_usd_per_day: number }; // 120 => 1$ в день на 120 DLAN
    invest_fee_recipient: string;
    tiers: VipTier[];
};

const USDT_DECIMALS = 6;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

export default function Home() {
    const [wallet, setWallet] = useState("");
    const [provider, setProvider] = useState<AnchorProvider>();
    const [program, setProgram] = useState<Program<Idl>>();

    const [dlanBal, setDlanBal] = useState<BN>(new BN(0));
    const [dlanSupply, setDlanSupply] = useState<BN>(new BN(1));
    const [dlanDecimals, setDlanDecimals] = useState(9);

    const [vip, setVip] = useState<VipConfig | null>(null);

    // ввод: сколько SOL стейкать
    const [stakeSol, setStakeSol] = useState("1");

    // накопительный таймстемп для INVEST-кнопки
    const investKey = useMemo(
        () => (wallet ? `invest:lastClaimTs:${wallet}` : ""),
        [wallet]
    );

    // helpers
    const fmt = useCallback((n: BN, decimals: number) => {
        const denom = 10 ** decimals;
        return (n.toNumber() / denom).toLocaleString(undefined, {
            maximumFractionDigits: decimals,
        });
    }, []);

    const dlanPct = useMemo(() => {
        if (dlanSupply.isZero()) return "0.00%";
        const p = (dlanBal.toNumber() / Number(dlanSupply.toString())) * 100;
        return `${p.toFixed(2)}%`;
    }, [dlanBal, dlanSupply]);

    // Jupiter QUOTE: сколько USDC выйдет за заданные лампорты SOL (без исполнения свопа)
    const fetchQuoteUsdcOut = useCallback(async (lamports: number): Promise<number | null> => {
        try {
            const url = new URL("https://quote-api.jup.ag/v6/quote");
            url.searchParams.set("inputMint", WSOL);
            url.searchParams.set("outputMint", USDC);
            url.searchParams.set("amount", String(lamports)); // для SOL — lamports
            url.searchParams.set("slippageBps", "10");        // 0.1% допустим
            const r = await fetch(url.toString(), { cache: "no-store" });
            const j = await r.json();
            const out = j?.outAmount; // строка в минимальных единицах USDC (6 d.p.)
            if (!out) return null;
            const n = Number(out);
            return Number.isFinite(n) && n > 0 ? n : null;
        } catch {
            return null;
        }
    }, []);

    // VIP загрузка
    const reloadVip = useCallback(async () => {
        try {
            const res = await fetch("/vip.json", { cache: "no-store" });
            if (!res.ok) throw new Error("vip.json missing");
            const data: VipConfig = await res.json();
            setVip(data);
        } catch {
            // дефолт, если нет файла
            setVip({
                invest_usd_per_dlan_rule: { dlan_per_usd_per_day: 120 },
                invest_fee_recipient: ADMIN_SOL_WALLET.toBase58(),
                tiers: [],
            });
        }
    }, []);

    // init balances + VIP
    useEffect(() => {
        (async () => {
            await reloadVip();
        })();
    }, [reloadVip]);

    useEffect(() => {
        if (!provider) return;
        (async () => {
            try {
                const info = await getMint(provider.connection, DLAN_MINT);
                setDlanDecimals(info.decimals);
                setDlanSupply(new BN(info.supply.toString()));

                if (provider.wallet?.publicKey) {
                    const pk = provider.wallet.publicKey;
                    const ata = await getAssociatedTokenAddress(DLAN_MINT, pk);
                    const bal = await provider.connection.getTokenAccountBalance(ata).catch(() => null);
                    setDlanBal(bal?.value?.amount ? new BN(bal.value.amount) : new BN(0));
                }
            } catch (e) {
                console.warn(e);
            }
        })();
    }, [provider]);

    // connect
    const handleConnect = useCallback(async () => {
        const sol = (window as any).solana;
        if (!sol?.isPhantom) return alert("Установите Phantom Wallet");
        const res = await sol.connect();
        setWallet(res.publicKey.toBase58());

        const conn = new Connection(clusterApiUrl("devnet"), "processed");
        const ap = new AnchorProvider(conn, sol, { commitment: "processed" });
        setProvider(ap);

        // двухаргум. конструктор
        const prog = new Program(IDL, ap);
        setProgram(prog);
    }, []);

    // ----- STAKE через «курс обмена» SOL→USDC (Jupiter quote), SOL уходит админу, DLAN минтится по USDC-эквиваленту -----
    const handleStakeViaQuote = useCallback(async () => {
        if (!provider || !program) return alert("Сначала подключитесь");
        try {
            const me = provider.wallet.publicKey!;
            const [mintAuth] = PublicKey.findProgramAddressSync(
                [Buffer.from("mint-auth")],
                program.programId
            );
            const userDlanAta = await getAssociatedTokenAddress(DLAN_MINT, me);

            const solNum = Math.max(0, Number(stakeSol || "0"));
            if (!solNum) return alert("Введите количество SOL");
            const lamports = Math.floor(solNum * 1e9);

            // 1) Получаем «сколько USDC вышло бы» из реального маршрута
            const usdcOutUnits = await fetchQuoteUsdcOut(lamports);
            if (usdcOutUnits == null) return alert("Не удалось получить котировку Jupiter");

            // 2) Пересчитываем в DLAN-юниты: хотим 1 DLAN == 1 USD
            //    usdcOutUnits имеет 6 знаков. DLAN может иметь, например, 9 знаков.
            //    mintUnits = usdcOutUnits * 10^(dlan_decimals - 6)  (или делим, если dlan_decimals<6)
            let mintUnits: number;
            if (dlanDecimals >= 6) {
                mintUnits = usdcOutUnits * 10 ** (dlanDecimals - 6);
            } else {
                mintUnits = Math.floor(usdcOutUnits / 10 ** (6 - dlanDecimals));
            }
            if (mintUnits <= 0) return alert("Слишком маленькая сумма (округление дало 0)");

            // 3) Один tx: SOL → admin + mint DLAN по рассчитанному количеству
            const sig = await program.methods
                .stakeAndMintPriced(new BN(lamports), new BN(mintUnits))
                .accounts({
                    authority: me,
                    admin: ADMIN_SOL_WALLET,
                    mint: DLAN_MINT,
                    userToken: userDlanAta,
                    mintAuthority: mintAuth,
                    systemProgram: SystemProgram.programId,
                    tokenProgram: TOKEN_PROGRAM_ID,
                    associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
                    rent: SYSVAR_RENT_PUBKEY,
                })
                .rpc();

            console.log("stake via quote sig:", sig);

            // обновим баланс
            const bal = await provider.connection.getTokenAccountBalance(userDlanAta);
            setDlanBal(new BN(bal.value.amount));

            const usdcFloat = usdcOutUnits / 10 ** USDT_DECIMALS;
            const dlanFloat = mintUnits / 10 ** dlanDecimals;
            alert(`Застейкано ${solNum} SOL. Курс по Jupiter дал ~${usdcFloat.toFixed(4)} USDC, начислено ${dlanFloat.toFixed(4)} DLAN.`);
        } catch (err: any) {
            console.error(err);
            alert("Ошибка stake:\n" + (err?.message || String(err)));
        }
    }, [provider, program, stakeSol, dlanDecimals, fetchQuoteUsdcOut]);

    // ----- VIP -----
    const myVip = useMemo(() => {
        if (!wallet || !vip) return null;
        return vip.tiers.find(t => t.wallet === wallet) || null;
    }, [wallet, vip]);

    const handleVipClaim = useCallback(
        async (usd: number) => {
            if (!provider || !program || !vip) return alert("Нет соединения");
            try {
                const me = provider.wallet.publicKey!;
                const total = Math.floor(usd * 10 ** USDT_DECIMALS);

                // проверим резерв
                const reserveInfo = await provider.connection.getTokenAccountBalance(VAULT_USDT_ATA);
                const reserve = Number(reserveInfo.value.amount);
                if (reserve < total) return alert("В хранилище недостаточно USDT");

                const tier = myVip;
                const feeRecipientStr =
                    (tier?.fee_recipient && tier.fee_recipient.length > 0)
                        ? tier.fee_recipient
                        : vip.invest_fee_recipient;

                const feeRecipient = new PublicKey(feeRecipientStr);
                const userUsdtAta = await getAssociatedTokenAddress(USDT_MINT, me);
                const feeAta = await getAssociatedTokenAddress(USDT_MINT, feeRecipient);

                const fee = Math.floor(total / 3);
                const user = total - fee;

                const sig = await program.methods
                    .claimUsdtSplit(new BN(user), new BN(fee))
                    .accounts({
                        authority: me,
                        userToken: userUsdtAta,
                        vaultToken: VAULT_USDT_ATA,
                        vaultAuthority: VAULT_AUTHORITY_PDA,
                        feeOwner: feeRecipient,
                        feeToken: feeAta,
                        usdtMint: USDT_MINT,
                        tokenProgram: TOKEN_PROGRAM_ID,
                        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
                        systemProgram: SystemProgram.programId,
                        rent: SYSVAR_RENT_PUBKEY,
                    })
                    .rpc();

                console.log("vip claim sig:", sig);
                alert(`VIP claim: ${usd.toFixed(2)} USDT (2/3 вам, 1/3 — fee)`);
            } catch (err: any) {
                console.error(err);
                alert("Ошибка VIP claim:\n" + (err?.message || String(err)));
            }
        },
        [provider, program, vip, myVip]
    );

    // ----- INVEST: каждые {dlan_per_usd_per_day} DLAN = 1$ в день (накопительно), со сплитом -----
    const computeInvestUsd = useCallback(async (): Promise<number> => {
        if (!provider || !vip || !wallet) return 0;
        const now = Date.now();

        let last = now - MS_PER_DAY;
        const raw = localStorage.getItem(investKey);
        if (raw) {
            const parsed = parseInt(raw, 10);
            if (!Number.isNaN(parsed)) last = parsed;
        }
        const days = Math.max(0, Math.floor((now - last) / MS_PER_DAY));
        if (days === 0) return 0;

        const denom = vip.invest_usd_per_dlan_rule?.dlan_per_usd_per_day || 120; // по умолчанию 120
        const dlanCount = dlanBal.toNumber() / 10 ** dlanDecimals;
        if (dlanCount <= 0) return 0;

        const perDayUsd = dlanCount / denom;
        const allowedUsd = days * perDayUsd;

        const reserveInfo = await provider.connection.getTokenAccountBalance(VAULT_USDT_ATA);
        const reserveUsd = Number(reserveInfo.value.amount) / 10 ** USDT_DECIMALS;

        return Math.max(0, Math.min(allowedUsd, reserveUsd));
    }, [provider, vip, wallet, investKey, dlanBal, dlanDecimals]);

    const handleInvestClaim = useCallback(async () => {
        if (!provider || !program || !vip || !wallet) return alert("Нет соединения");
        try {
            const me = provider.wallet.publicKey!;
            const maxUsd = await computeInvestUsd();
            if (maxUsd <= 0) return alert("Сегодня клейм недоступен");

            const total = Math.floor(maxUsd * 10 ** USDT_DECIMALS);

            const feeRecipient = new PublicKey(vip.invest_fee_recipient);
            const userUsdtAta = await getAssociatedTokenAddress(USDT_MINT, me);
            const feeAta = await getAssociatedTokenAddress(USDT_MINT, feeRecipient);

            const fee = Math.floor(total / 3);
            const user = total - fee;

            const sig = await program.methods
                .claimUsdtSplit(new BN(user), new BN(fee))
                .accounts({
                    authority: me,
                    userToken: userUsdtAta,
                    vaultToken: VAULT_USDT_ATA,
                    vaultAuthority: VAULT_AUTHORITY_PDA,
                    feeOwner: feeRecipient,
                    feeToken: feeAta,
                    usdtMint: USDT_MINT,
                    tokenProgram: TOKEN_PROGRAM_ID,
                    associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
                    systemProgram: SystemProgram.programId,
                    rent: SYSVAR_RENT_PUBKEY,
                })
                .rpc();

            console.log("invest claim sig:", sig);

            // сдвигаем lastClaimTs пропорционально реально списанным дням
            const now = Date.now();
            const raw = localStorage.getItem(investKey);
            const last = raw ? parseInt(raw, 10) : now - MS_PER_DAY;

            const denom = vip.invest_usd_per_dlan_rule?.dlan_per_usd_per_day || 120;
            const perDayUsd = (dlanBal.toNumber() / 10 ** dlanDecimals) / denom;
            const claimedDays = perDayUsd > 0 ? Math.floor(maxUsd / perDayUsd) : 0;

            const newLast = last + claimedDays * MS_PER_DAY;
            localStorage.setItem(investKey, String(newLast));

            alert(`Инвест-клейм: ${maxUsd.toFixed(4)} USDT (2/3 вам, 1/3 — fee)`);
        } catch (err: any) {
            console.error(err);
            alert("Ошибка Invest claim:\n" + (err?.message || String(err)));
        }
    }, [provider, program, vip, wallet, computeInvestUsd, investKey, dlanBal, dlanDecimals]);

    // UI
    return (
        <div style={{ padding: 24, fontFamily: "Inter, system-ui, sans-serif", maxWidth: 900, margin: "0 auto" }}>
            <h1>DLAN — Stake по курсу обмена SOL→USDC & Claim</h1>

            {!wallet ? (
                <button onClick={handleConnect} style={btnPrimary}>Connect Phantom</button>
            ) : (
                <>
                    <p>Connected: {wallet}</p>

                    <div style={{ padding: 12, border: "1px solid #ddd", borderRadius: 8, marginBottom: 16 }}>
                        <div>Ваш DLAN: <b>{fmt(dlanBal, dlanDecimals)}</b></div>
                            <div>Всего DLAN: <b>{fmt(dlanSupply, dlanDecimals)}</b></div>
                            <div>Ваша доля: <b>{dlanPct}</b></div>
                        </div>
                    <div style={{ padding: 12, border: "1px solid #ddd", borderRadius: 8, marginBottom: 16 }}>
                        <h3 style={{ marginTop: 0 }}>Stake через обменный курс (Jupiter quote)</h3>
                        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                            <input
                                type="number"
                                min="0"
                                step="0.000001"
                                value={stakeSol}
                                onChange={(e) => setStakeSol(e.target.value)}
                                style={{ width: 160 }}
                            />
                            <span>SOL</span>
                            <button style={btnPrimary} onClick={handleStakeViaQuote}>Stake & Mint по «реальному» курсу</button>
                        </div>
                        <small>SOL отправится на {ADMIN_SOL_WALLET.toBase58()}, DLAN минтится ≈ USDC-эквивалент (по котировке Jupiter).</small>
                    </div>

                    <div style={{ padding: 12, border: "1px solid #ddd", borderRadius: 8, marginBottom: 16 }}>
                        <h3 style={{ marginTop: 0 }}>
                            Invest claim (накопительно): 1$ в день на каждые {vip?.invest_usd_per_dlan_rule?.dlan_per_usd_per_day ?? 120} DLAN
                        </h3>
                        <button style={btnSecondary} onClick={handleInvestClaim}>Claim invest</button>
                    </div>

                    <div style={{ padding: 12, border: "1px solid #ddd", borderRadius: 8 }}>
                        <h3 style={{ marginTop: 0 }}>
                            VIP claim
                            <button style={{ marginLeft: 12 }} onClick={reloadVip}>Reload VIP rules</button>
                        </h3>
                        {vip && (vip.tiers.find(t => t.wallet === wallet)) ? (
                            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                                {(vip.tiers.find(t => t.wallet === wallet)!.buttons).map((usd) => (
                                    <button key={usd} style={btnVip} onClick={() => handleVipClaim(usd)}>
                                        Claim {usd} USDT
                                    </button>
                                ))}
                            </div>
                        ) : (
                            <div>Ваш адрес не в VIP-списке</div>
                        )}
                    </div>
                </>
            )}
        </div>
    );
}
// Updated button styles for uniformity
const btnPrimary = {
    padding: "14px 22px",
    borderRadius: 16,
    background: "linear-gradient(135deg, #6a5cff, #8d6bff)",
    color: "white",
    border: "none",
    fontWeight: 700,
    fontSize: 16,
    cursor: "pointer",
    boxShadow: "0 10px 24px rgba(90, 70, 255, 0.25)",
};

const btnSecondary = {
    padding: "14px 22px",
    borderRadius: 16,
    background: "linear-gradient(135deg, #ff6f61, #ff9f71)",
    color: "white",
    border: "none",
    fontWeight: 700,
    fontSize: 16,
    cursor: "pointer",
    boxShadow: "0 10px 24px rgba(255, 105, 97, 0.25)",
};

const btnVip = {
    padding: "14px 22px",
    borderRadius: 16,
    background: "linear-gradient(135deg, #f1c40f, #f39c12)",
    color: "white",
    border: "none",
    fontWeight: 700,
    fontSize: 16,
    cursor: "pointer",
    boxShadow: "0 10px 24px rgba(243, 156, 18, 0.25)",
};
