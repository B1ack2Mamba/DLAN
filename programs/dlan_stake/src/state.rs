use anchor_lang::prelude::*;

#[account]
pub struct Pool {
    pub owner: Pubkey,
    pub treasury: Pubkey,
    pub total_staked: u64,
    pub acc_rewards_per_share: u128,
}

#[account]
pub struct UserPosition {
    pub pool: Pubkey,
    pub owner: Pubkey,
    pub amount: u64,
    pub reward_debt: u128,
}
