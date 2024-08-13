use anchor_lang::error_code;

#[error_code]
pub enum RewardVaultError {
    #[msg("invalid signature")]
    InvalidSignature,

    #[msg("expired signature")]
    ExpiredSignature,

    #[msg("withdraw too much")]
    WithdrawTooMuch,

    #[msg("signature verification failed.")]
    SigVerificationFailed,
}
