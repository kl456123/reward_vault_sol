use anchor_lang::prelude::*;

#[account]
#[derive(InitSpace, Default)]
pub struct RewardVault {
    pub authority: Pubkey,
}

#[account]
#[derive(InitSpace, Default)]
pub struct ProjectVault {
    /// deposited token
    pub token: Pubkey,

    /// project id
    pub id: Pubkey,

    pub amounts: u64,
}

#[account]
#[derive(InitSpace, Default)]
pub struct SignatureRecord {
    pub is_used: bool,
}
