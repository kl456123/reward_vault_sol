use anchor_lang::prelude::*;

mod constants;
mod error;
mod instructions;
mod state;

declare_id!("4JY65Ye7EoPiWbAn1rSLZ5JkrNYRvH37HHkcLFEtkJoa");

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

    pub fn claim(ctx: Context<Claim>) -> Result<()> {
        instructions::claim(ctx)
    }
}