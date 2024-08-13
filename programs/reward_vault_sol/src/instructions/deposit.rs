use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token::{transfer, Mint, Token, TokenAccount, Transfer},
};
use solana_program::instruction::Instruction;
use solana_program::sysvar::instructions::{load_instruction_at_checked, ID as IX_ID};

use crate::constants::ANCHOR_DISCRIMINATOR;
use crate::error::RewardVaultError;
use crate::state::{ProjectVault, RewardVault};
use crate::utils;

#[event]
pub struct TokenDeposited {
    project_id: u64,
    deposit_id: u64,
    token: Pubkey,
    amount: u64,
}

#[derive(Accounts)]
#[instruction(deposit_param: DepositParam)]
pub struct Deposit<'info> {
    #[account(mut)]
    pub depositor: Signer<'info>,

    pub token_mint: Account<'info, Mint>,

    #[account(
        seeds = [b"reward_vault"],
        bump
        )]
    pub reward_vault: Account<'info, RewardVault>,

    #[account(
    init_if_needed,
    payer=depositor,
    space=ANCHOR_DISCRIMINATOR + ProjectVault::INIT_SPACE,
    seeds=[b"project_vault", deposit_param.project_id.to_le_bytes().as_slice(), token_mint.key().as_ref()],
    bump
    )]
    pub project_vault: Account<'info, ProjectVault>,

    #[account(init_if_needed, payer=depositor, associated_token::mint=token_mint, associated_token::authority=reward_vault)]
    pub vault_token_account: Account<'info, TokenAccount>,

    #[account(mut, associated_token::mint=token_mint, associated_token::authority=depositor)]
    pub depositor_token_account: Account<'info, TokenAccount>,

    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,

    /// CHECK: The address check is needed because otherwise
    /// the supplied Sysvar could be anything else.
    /// The Instruction Sysvar has not been implemented
    /// in the Anchor framework yet, so this is the safe approach.
    #[account(address = IX_ID)]
    pub ix_sysvar: UncheckedAccount<'info>,
}

#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct DepositParam {
    project_id: u64,
    deposit_id: u64,
    amount: u64,
    expiration_time: i64,
}

#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct SignatureParam {
    eth_address: [u8; 20],
    sig: [u8; 64],
    recovery_id: u8,
}

pub fn deposit(
    ctx: Context<Deposit>,
    deposit_param: DepositParam,
    signature_param: SignatureParam,
) -> Result<()> {
    let current_time = Clock::get()?.unix_timestamp;
    require!(
        current_time < deposit_param.expiration_time,
        RewardVaultError::ExpiredSignature
    );

    let msg = deposit_param.try_to_vec()?;

    // Get what should be the Secp256k1Program instruction
    let ix: Instruction = load_instruction_at_checked(0, &ctx.accounts.ix_sysvar)?;

    // Check that ix is what we expect to have been sent
    utils::verify_secp256k1_ix(
        &ix,
        &signature_param.eth_address,
        &msg,
        &signature_param.sig,
        signature_param.recovery_id,
    )?;

    // transfer depositor's tokens to vault
    let cpi_program = ctx.accounts.token_program.to_account_info();
    let cpi_accounts = Transfer {
        from: ctx.accounts.depositor_token_account.to_account_info(),
        to: ctx.accounts.vault_token_account.to_account_info(),
        authority: ctx.accounts.depositor.to_account_info(),
    };
    let cpi_context = CpiContext::new(cpi_program, cpi_accounts);
    transfer(cpi_context, deposit_param.amount)?;

    // update project vault account
    if ctx.accounts.project_vault.id == 0 {
        // init only once
        ctx.accounts.project_vault.token = ctx.accounts.token_mint.key();
        ctx.accounts.project_vault.id = deposit_param.project_id;
    }

    ctx.accounts.project_vault.amounts += deposit_param.amount;

    emit!(TokenDeposited {
        project_id: deposit_param.project_id,
        deposit_id: deposit_param.deposit_id,
        token: ctx.accounts.token_mint.key(),
        amount: deposit_param.amount,
    });

    Ok(())
}
