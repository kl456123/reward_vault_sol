use anchor_lang::prelude::*;

mod constants;
mod error;
mod instructions;
mod state;

declare_id!("eipFhdNMUZrXwhej7vwDraJVSXyGCHExJUUKboqv1iD");

#[program]
pub mod reward_vault_sol {
    pub use super::instructions::*;
    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        instructions::initialize(ctx)
    }

    pub fn deposit(ctx: Context<Deposit>, deposit_param: DepositParam) -> Result<()> {
        instructions::deposit(ctx, deposit_param)
    }

    pub fn withdraw(ctx: Context<Withdrawal>, withdrawal_param: WithdrawalParam) -> Result<()> {
        instructions::withdraw(ctx, withdrawal_param)
    }

    pub fn claim(ctx: Context<Claim>, claim_param: ClaimParam) -> Result<()> {
        instructions::claim(ctx, claim_param)
    }

    ////////////////// admin operations  ////////////////////////////////
    pub fn transfer_ownership(ctx: Context<TransferOwnership>) -> Result<()> {
        instructions::transfer_ownership(ctx)
    }

    pub fn config_signer(ctx: Context<SignerConfig>, flag: bool) -> Result<()> {
        instructions::config_signer(ctx, flag)
    }
}
