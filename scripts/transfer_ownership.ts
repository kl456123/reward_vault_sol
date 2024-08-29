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

module.exports = async function (provider: AnchorProvider) {
  // Configure client to use the provider.
  anchor.setProvider(provider);
  const wallet = provider.wallet as anchor.Wallet;
  const connection = provider.connection;
  const program = new Program<RewardVaultSol>(idl as RewardVaultSol);

  const [rewardVaultPda] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from("reward_vault")],
    program.programId
  );

  const admin = (await program.account.rewardVault.fetch(rewardVaultPda))
    .authority;
  console.log("current admin: ", admin.toString());

  if (!wallet.publicKey.equals(admin)) {
    throw new Error(
      `wallet[${wallet.publicKey.toString()}] is not current admin[${admin.toString()}], have no permission to transfer ownership`
    );
  }

  await program.methods
    .transferOwnership()
    .accountsPartial({
      rewardVault: rewardVaultPda,
      newAdmin: new anchor.web3.PublicKey(
        "2GU2SchPNjXSq99LhXiHnFAzrby4KQdecsjVUJmRevLF"
      ),
      admin: wallet.publicKey,
      payer: wallet.publicKey,
    })
    .rpc();
  const newAdmin = (await program.account.rewardVault.fetch(rewardVaultPda))
    .authority;
  console.log("new admin: ", newAdmin.toString());
};
