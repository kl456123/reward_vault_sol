// Migrations are an early feature. Currently, they're nothing more than this
// single deploy script that's invoked from the CLI, injecting a provider
// configured from the workspace's Anchor.toml.

import * as anchor from "@coral-xyz/anchor";
import { Idl, Program, AnchorProvider } from "@coral-xyz/anchor";
import { RewardVaultSol } from "../target/types/reward_vault_sol";
import idl from "../target/idl/reward_vault_sol.json";

import {
  createMint,
  getAssociatedTokenAddressSync,
  getOrCreateAssociatedTokenAccount,
  mintTo,
} from "@solana/spl-token";

async function main() {
  const provider = anchor.AnchorProvider.local("https://api.devnet.solana.com");
  // Configure client to use the provider.
  anchor.setProvider(provider);
  const wallet = provider.wallet as anchor.Wallet;
  const connection = provider.connection;

  const program = new Program<RewardVaultSol>(idl as RewardVaultSol);
  // setup reward vault
  const [rewardVaultPda] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from("reward_vault")],
    program.programId
  );
  const rewardVault = await program.account.rewardVault.fetch(rewardVaultPda);
  const signer = new anchor.web3.PublicKey(
    "2GU2SchPNjXSq99LhXiHnFAzrby4KQdecsjVUJmRevLF"
  );

  if (rewardVault.signers.findIndex((item) => item.equals(signer)) === -1) {
    await program.methods
      .configSigner(true)
      .accountsPartial({
        rewardVault: rewardVaultPda,
        signer,
        admin: wallet.publicKey,
      })
      .signers([wallet.payer])
      .rpc({ commitment: "confirmed" });
    // check after tx is confirmed
    const rewardVault = await program.account.rewardVault.fetch(rewardVaultPda);
    console.log(rewardVault.signers);
  } else {
    console.log(`signer:${signer.toString()} is added already`);
  }
}

main();
