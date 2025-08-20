use anchor_lang::prelude::*;
use anchor_lang::solana_program::{clock::Clock, program::invoke, system_instruction};
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{self, Mint, MintTo, Token, TokenAccount, Transfer};

declare_id!("3hQsDEYknZmKKUBApAGtcGPy395ogJdiB8DCvMKh24K7");

const SECS_PER_DAY: i64 = 86_400;

#[program]
pub mod dlan_stake {
    use super::*;

    // -------- STAKE --------

    /// ЛЕГАСИ: amount==лампорты и == количеству DLAN (оставлено для совместимости).
    pub fn stake_and_mint(ctx: Context<StakeAndMint>, amount: u64) -> Result<()> {
        stake_and_mint_priced(ctx, amount, amount)
    }

    /// НОВОЕ: стейкаем `sol_lamports` → переводим на admin; минтим ровно `mint_amount` DLAN.
    pub fn stake_and_mint_priced(
        ctx: Context<StakeAndMint>,
        sol_lamports: u64,
        mint_amount: u64,
    ) -> Result<()> {
        // 1) SOL → admin
        let ix = system_instruction::transfer(
            &ctx.accounts.authority.key(),
            &ctx.accounts.admin.key(),
            sol_lamports,
        );
        invoke(
            &ix,
            &[
                ctx.accounts.authority.to_account_info(),
                ctx.accounts.admin.to_account_info(),
                ctx.accounts.system_program.to_account_info(),
            ],
        )?;

        // 2) Mint DLAN пользователю от имени PDA mint_authority
        let bump = ctx.bumps.mint_authority;
        let bump_bytes = [bump];
        let seeds: &[&[u8]] = &[b"mint-auth", &bump_bytes];
        let signer_seeds: &[&[&[u8]]] = &[seeds];

        let cpi_accounts = MintTo {
            mint: ctx.accounts.mint.to_account_info(),
            to: ctx.accounts.user_token.to_account_info(),
            authority: ctx.accounts.mint_authority.to_account_info(),
        };
        let cpi_ctx = CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            cpi_accounts,
            signer_seeds,
        );
        token::mint_to(cpi_ctx, mint_amount)?;
        Ok(())
    }

    // -------- БАЗОВЫЙ КЛЕЙМ (без таймера) --------
    // Оставлен для совместимости; VIP-кнопки теперь используют timed-версию ниже.

    pub fn claim_usdt_split(
        ctx: Context<ClaimUsdtSplit>,
        user_amount: u64,
        fee_amount: u64,
    ) -> Result<()> {
        let bump = ctx.bumps.vault_authority;
        let seeds: &[&[u8]] = &[b"vault-auth", &[bump]];
        let signer: &[&[&[u8]]] = &[seeds];

        if user_amount > 0 {
            let cpi_accounts = Transfer {
                from: ctx.accounts.vault_token.to_account_info(),
                to: ctx.accounts.user_token.to_account_info(),
                authority: ctx.accounts.vault_authority.to_account_info(),
            };
            token::transfer(
                CpiContext::new_with_signer(
                    ctx.accounts.token_program.to_account_info(),
                    cpi_accounts,
                    signer,
                ),
                user_amount,
            )?;
        }

        if fee_amount > 0 {
            let cpi_accounts = Transfer {
                from: ctx.accounts.vault_token.to_account_info(),
                to: ctx.accounts.fee_token.to_account_info(),
                authority: ctx.accounts.vault_authority.to_account_info(),
            };
            token::transfer(
                CpiContext::new_with_signer(
                    ctx.accounts.token_program.to_account_info(),
                    cpi_accounts,
                    signer,
                ),
                fee_amount,
            )?;
        }

        Ok(())
    }

    // -------- ИНВЕСТ-КЛЕЙМ (таймер ончейн) --------

    pub fn invest_claim_split(
        ctx: Context<InvestClaimSplit>,
        user_amount: u64,
        fee_amount: u64,
        claimed_days: u64,
    ) -> Result<()> {
        require!(claimed_days > 0, ErrorCode::ZeroDays);

        let now = Clock::get()?.unix_timestamp;
        let st = &mut ctx.accounts.user_state;

        let baseline = if st.last_invest_ts == 0 {
            now - SECS_PER_DAY
        } else {
            st.last_invest_ts
        };
        let elapsed_days: u64 = if now > baseline {
            ((now - baseline) / SECS_PER_DAY) as u64
        } else {
            0
        };
        require!(claimed_days <= elapsed_days, ErrorCode::NotEnoughElapsedDays);

        st.last_invest_ts = baseline + (claimed_days as i64) * SECS_PER_DAY;

        let bump = ctx.bumps.vault_authority;
        let seeds: &[&[u8]] = &[b"vault-auth", &[bump]];
        let signer: &[&[&[u8]]] = &[seeds];

        if user_amount > 0 {
            let cpi_accounts = Transfer {
                from: ctx.accounts.vault_token.to_account_info(),
                to: ctx.accounts.user_token.to_account_info(),
                authority: ctx.accounts.vault_authority.to_account_info(),
            };
            token::transfer(
                CpiContext::new_with_signer(
                    ctx.accounts.token_program.to_account_info(),
                    cpi_accounts,
                    signer,
                ),
                user_amount,
            )?;
        }
        if fee_amount > 0 {
            let cpi_accounts = Transfer {
                from: ctx.accounts.vault_token.to_account_info(),
                to: ctx.accounts.fee_token.to_account_info(),
                authority: ctx.accounts.vault_authority.to_account_info(),
            };
            token::transfer(
                CpiContext::new_with_signer(
                    ctx.accounts.token_program.to_account_info(),
                    cpi_accounts,
                    signer,
                ),
                fee_amount,
            )?;
        }
        Ok(())
    }

    // -------- VIP-КЛЕЙМ (таймер ончейн) --------

    pub fn vip_claim_split_timed(
        ctx: Context<VipClaimSplitTimed>,
        user_amount: u64,
        fee_amount: u64,
        requested_days: u64,
    ) -> Result<()> {
        require!(requested_days > 0, ErrorCode::ZeroDays);

        let now = Clock::get()?.unix_timestamp;
        let st = &mut ctx.accounts.vip_state;

        let baseline = if st.last_vip_ts == 0 {
            now - SECS_PER_DAY
        } else {
            st.last_vip_ts
        };
        let elapsed_days: u64 = if now > baseline {
            ((now - baseline) / SECS_PER_DAY) as u64
        } else {
            0
        };
        require!(requested_days <= elapsed_days, ErrorCode::NotEnoughElapsedDays);

        st.last_vip_ts = baseline + (requested_days as i64) * SECS_PER_DAY;

        let bump = ctx.bumps.vault_authority;
        let seeds: &[&[u8]] = &[b"vault-auth", &[bump]];
        let signer: &[&[&[u8]]] = &[seeds];

        if user_amount > 0 {
            let cpi_accounts = Transfer {
                from: ctx.accounts.vault_token.to_account_info(),
                to: ctx.accounts.user_token.to_account_info(),
                authority: ctx.accounts.vault_authority.to_account_info(),
            };
            token::transfer(
                CpiContext::new_with_signer(
                    ctx.accounts.token_program.to_account_info(),
                    cpi_accounts,
                    signer,
                ),
                user_amount,
            )?;
        }
        if fee_amount > 0 {
            let cpi_accounts = Transfer {
                from: ctx.accounts.vault_token.to_account_info(),
                to: ctx.accounts.fee_token.to_account_info(),
                authority: ctx.accounts.vault_authority.to_account_info(),
            };
            token::transfer(
                CpiContext::new_with_signer(
                    ctx.accounts.token_program.to_account_info(),
                    cpi_accounts,
                    signer,
                ),
                fee_amount,
            )?;
        }
        Ok(())
    }
}

/* -------------------- Accounts -------------------- */

#[derive(Accounts)]
pub struct StakeAndMint<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    /// CHECK: системный (админский) аккаунт — получатель SOL
    #[account(mut)]
    pub admin: AccountInfo<'info>,

    #[account(mut)]
    pub mint: Account<'info, Mint>,

    #[account(
        init_if_needed,
        payer = authority,
        associated_token::mint = mint,
        associated_token::authority = authority
    )]
    pub user_token: Account<'info, TokenAccount>,

    /// CHECK: PDA для чеканки (signer по сидy)
    #[account(seeds = [b"mint-auth"], bump)]
    pub mint_authority: AccountInfo<'info>,

    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct ClaimUsdtSplit<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        init_if_needed,
        payer = authority,
        associated_token::mint = usdt_mint,
        associated_token::authority = authority
    )]
    pub user_token: Account<'info, TokenAccount>,

    #[account(mut)]
    pub vault_token: Account<'info, TokenAccount>,

    /// CHECK: PDA-владелец vault
    #[account(seeds = [b"vault-auth"], bump)]
    pub vault_authority: AccountInfo<'info>,

    /// CHECK: владелец fee-ATA
    pub fee_owner: AccountInfo<'info>,

    #[account(
        init_if_needed,
        payer = authority,
        associated_token::mint = usdt_mint,
        associated_token::authority = fee_owner
    )]
    pub fee_token: Account<'info, TokenAccount>,

    pub usdt_mint: Account<'info, Mint>,

    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct InvestClaimSplit<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        init_if_needed,
        payer = authority,
        space = 8 + 8, // discriminator + i64
        seeds = [b"user", authority.key().as_ref()],
        bump
    )]
    pub user_state: Account<'info, UserState>,

    #[account(
        init_if_needed,
        payer = authority,
        associated_token::mint = usdt_mint,
        associated_token::authority = authority
    )]
    pub user_token: Account<'info, TokenAccount>,

    #[account(mut)]
    pub vault_token: Account<'info, TokenAccount>,

    /// CHECK
    #[account(seeds = [b"vault-auth"], bump)]
    pub vault_authority: AccountInfo<'info>,

    /// CHECK
    pub fee_owner: AccountInfo<'info>,

    #[account(
        init_if_needed,
        payer = authority,
        associated_token::mint = usdt_mint,
        associated_token::authority = fee_owner
    )]
    pub fee_token: Account<'info, TokenAccount>,

    pub usdt_mint: Account<'info, Mint>,

    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct VipClaimSplitTimed<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        init_if_needed,
        payer = authority,
        space = 8 + 8, // discriminator + i64
        seeds = [b"vip", authority.key().as_ref()],
        bump
    )]
    pub vip_state: Account<'info, VipState>,

    #[account(
        init_if_needed,
        payer = authority,
        associated_token::mint = usdt_mint,
        associated_token::authority = authority
    )]
    pub user_token: Account<'info, TokenAccount>,

    #[account(mut)]
    pub vault_token: Account<'info, TokenAccount>,

    /// CHECK
    #[account(seeds = [b"vault-auth"], bump)]
    pub vault_authority: AccountInfo<'info>,

    /// CHECK
    pub fee_owner: AccountInfo<'info>,

    #[account(
        init_if_needed,
        payer = authority,
        associated_token::mint = usdt_mint,
        associated_token::authority = fee_owner
    )]
    pub fee_token: Account<'info, TokenAccount>,

    pub usdt_mint: Account<'info, Mint>,

    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

/* -------------------- State & Errors -------------------- */

#[account]
pub struct UserState {
    pub last_invest_ts: i64,
}

#[account]
pub struct VipState {
    pub last_vip_ts: i64,
}

#[error_code]
pub enum ErrorCode {
    #[msg("Not enough elapsed days since last claim.")]
    NotEnoughElapsedDays,
    #[msg("requested/claimed days must be > 0")]
    ZeroDays,
}
