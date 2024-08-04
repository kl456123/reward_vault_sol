// Migrations are an early feature. Currently, they're nothing more than this
// single deploy script that's invoked from the CLI, injecting a provider
// configured from the workspace's Anchor.toml.

import * as anchor from "@coral-xyz/anchor";
import { Idl, Program, AnchorProvider } from "@coral-xyz/anchor";
import { RewardVaultSol } from "../target/types/reward_vault_sol";
import idl from "../target/idl/reward_vault_sol.json";

module.exports = async function (provider: AnchorProvider) {
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

  // uninitialized
  if ((await connection.getBalance(rewardVaultPda)) === 0) {
    await program.methods
      .initialize()
      .accountsPartial({
        rewardVault: rewardVaultPda,
        authority: wallet.publicKey,
        payer: wallet.publicKey,
      })
      .rpc({ commitment: "confirmed" });
  }

  const rewardVault = await program.account.rewardVault.fetch(rewardVaultPda);
  console.log(rewardVault.authority.toString());
};
