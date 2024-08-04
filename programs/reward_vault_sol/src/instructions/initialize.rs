use anchor_lang::prelude::*;

use crate::constants::ANCHOR_DISCRIMINATOR;
use crate::state::RewardVault;

pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
    ctx.accounts.reward_vault.set_inner(RewardVault {
        authority: ctx.accounts.authority.key(),
    });
    Ok(())
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(
        init,
        payer=payer,
        space = ANCHOR_DISCRIMINATOR + RewardVault::INIT_SPACE,
        seeds = [b"reward_vault"],
        bump
        )]
    pub reward_vault: Account<'info, RewardVault>,

    /// CHECK: Read only
    pub authority: UncheckedAccount<'info>,

    /// to pay rent fee when create account
    #[account(mut)]
    pub payer: Signer<'info>,

    pub system_program: Program<'info, System>,
}
