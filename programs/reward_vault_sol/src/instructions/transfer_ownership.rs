use anchor_lang::prelude::*;

use crate::error::RewardVaultError;
use crate::state::RewardVault;

pub fn transfer_ownership(ctx: Context<TransferOwnership>) -> Result<()> {
    ctx.accounts.reward_vault.authority = ctx.accounts.new_admin.key();

    emit!(RewardVaultOwnershipTransfered {
        authority: ctx.accounts.new_admin.key()
    });
    Ok(())
}

#[event]
pub struct RewardVaultOwnershipTransfered {
    pub authority: Pubkey,
}

#[derive(Accounts)]
pub struct TransferOwnership<'info> {
    #[account(
        mut,
        seeds = [b"reward_vault"],
        bump,
        constraint = reward_vault.authority == admin.key() @RewardVaultError::InvalidSignature,
        )]
    pub reward_vault: Account<'info, RewardVault>,

    /// CHECK: Read only
    pub new_admin: UncheckedAccount<'info>,

    pub admin: Signer<'info>,

    /// to pay rent fee when create account
    #[account(mut)]
    pub payer: Signer<'info>,

    pub system_program: Program<'info, System>,
}
