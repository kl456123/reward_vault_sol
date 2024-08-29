use anchor_lang::prelude::*;

use crate::error::RewardVaultError;
use crate::state::RewardVault;

#[derive(Accounts)]
pub struct SignerConfig<'info> {
    pub admin: Signer<'info>,

    /// CHECK readonly account
    pub signer: UncheckedAccount<'info>,

    #[account(
        mut,
        seeds = [b"reward_vault"],
        bump = reward_vault.bump,
        constraint = reward_vault.is_owner(&admin.key()) @RewardVaultError::InvalidSignature,
        )]
    pub reward_vault: Account<'info, RewardVault>,
    pub system_program: Program<'info, System>,
}

pub fn config_signer(ctx: Context<SignerConfig>, flag: bool) -> Result<()> {
    if flag {
        ctx.accounts
            .reward_vault
            .add_signer(&ctx.accounts.signer.key())
    } else {
        ctx.accounts
            .reward_vault
            .remove_signer(&ctx.accounts.signer.key())
    }
}
