use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token::{transfer, Mint, Token, TokenAccount, Transfer},
};

use crate::error::RewardVaultError;
use crate::state::RewardVault;

#[event]
pub struct TokenClaimed {
    project_id: u64,
    claim_id: u64,
    amount: u64,
    token: Pubkey,
    recipient: Pubkey,
}

#[derive(Accounts)]
#[instruction(claim_param: ClaimParam)]
pub struct Claim<'info> {
    pub token_mint: Account<'info, Mint>,

    pub admin: Signer<'info>,

    #[account(
        seeds = [b"reward_vault"],
        bump = reward_vault.bump,
        constraint = reward_vault.is_valid_signer(&admin.key()) @RewardVaultError::InvalidSignature,
        )]
    pub reward_vault: Account<'info, RewardVault>,

    /// CHECK: Read only
    pub recipient: UncheckedAccount<'info>,

    #[account(mut, associated_token::mint=token_mint, associated_token::authority=reward_vault)]
    pub vault_token_account: Account<'info, TokenAccount>,

    #[account(mut, associated_token::mint=token_mint, associated_token::authority=recipient)]
    pub recipient_token_account: Account<'info, TokenAccount>,

    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
}

#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct ClaimParam {
    project_id: u64,
    claim_id: u64,
    amount: u64,
    expiration_time: i64,
}

pub fn claim(ctx: Context<Claim>, claim_param: ClaimParam) -> Result<()> {
    let current_time = Clock::get()?.unix_timestamp;
    require!(
        current_time < claim_param.expiration_time,
        RewardVaultError::ExpiredSignature
    );

    // transfer depositor's tokens to vault
    let cpi_program = ctx.accounts.token_program.to_account_info();
    let cpi_accounts = Transfer {
        from: ctx.accounts.vault_token_account.to_account_info(),
        to: ctx.accounts.recipient_token_account.to_account_info(),
        authority: ctx.accounts.reward_vault.to_account_info(),
    };
    // Signer seeds to sign the CPI on behalf of the fundraiser account
    let signer_seeds: [&[&[u8]]; 1] =
        [&[b"reward_vault".as_ref(), &[ctx.accounts.reward_vault.bump]]];

    // CPI context with signer since the fundraiser account is a PDA
    let cpi_ctx = CpiContext::new_with_signer(cpi_program, cpi_accounts, &signer_seeds);
    transfer(cpi_ctx, claim_param.amount)?;

    emit!(TokenClaimed {
        project_id: claim_param.project_id,
        claim_id: claim_param.claim_id,
        amount: claim_param.amount,
        token: ctx.accounts.token_mint.key(),
        recipient: ctx.accounts.recipient.key(),
    });
    Ok(())
}
