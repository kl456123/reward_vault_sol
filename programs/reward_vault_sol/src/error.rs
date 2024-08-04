use anchor_lang::error_code;

#[error_code]
pub enum RewardVaultError {
    #[msg("used signature")]
    SignatureUsed,

    #[msg("invalid signature")]
    InvalidSignature,

    #[msg("expired signature")]
    ExpiredSignature,
}
