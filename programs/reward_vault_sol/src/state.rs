use anchor_lang::prelude::*;

use crate::constants::MAX_NUM_SIGNERS;
use crate::error::RewardVaultError;

#[account]
#[derive(InitSpace, Default)]
pub struct RewardVault {
    pub authority: Pubkey,
    pub bump: u8,
    #[max_len(MAX_NUM_SIGNERS)]
    pub signers: Vec<Pubkey>,
}

impl RewardVault {
    pub fn add_signer(&mut self, new_signer: &Pubkey) -> Result<()> {
        require!(
            !self.is_valid_signer(new_signer),
            RewardVaultError::SignerAddedAlready
        );
        self.signers.push(*new_signer);
        Ok(())
    }

    pub fn remove_signer(&mut self, signer: &Pubkey) -> Result<()> {
        let index = self
            .signers
            .iter()
            .position(|x| x == signer)
            .ok_or(error!(RewardVaultError::SignerNotExist))?;
        self.signers.remove(index);
        Ok(())
    }

    pub fn is_valid_signer(&self, signer: &Pubkey) -> bool {
        self.signers.contains(signer)
    }

    pub fn is_owner(&self, owner: &Pubkey) -> bool {
        &self.authority == owner
    }
}

#[account]
#[derive(InitSpace, Default)]
pub struct ProjectVault {
    /// deposited token
    pub token: Pubkey,

    /// project id
    pub id: u64,

    pub amounts: u64,
}
