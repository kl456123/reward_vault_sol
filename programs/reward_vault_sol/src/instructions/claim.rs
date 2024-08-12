use anchor_lang::prelude::*;

#[derive(Accounts)]
pub struct Claim<'info> {
    system_program: Program<'info, System>,
}

pub fn claim(ctx: Context<Claim>) -> Result<()> {
    msg!("claim called in : {:?}", ctx.program_id);
    Ok(())
}
