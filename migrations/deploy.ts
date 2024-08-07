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

  // init when it's uninitialized
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

  // setup tokens and ata accounts
  const depositor = wallet.payer;
  // const tokenMint = new anchor.web3.PublicKey('7EbR2rZQPBBTUVULsWZYi6CAwaC49VEXNhxA1pA18CS8')
  const tokenMint = await createMint(
    provider.connection,
    wallet.payer,
    provider.publicKey,
    provider.publicKey,
    6
  );
  console.log("token mint: ", tokenMint);
  const depositorTokenAccount = (
    await getOrCreateAssociatedTokenAccount(
      provider.connection,
      wallet.payer,
      tokenMint,
      depositor.publicKey
    )
  ).address;
  // create a ata account owned by program
  const vaultTokenAccount = await getAssociatedTokenAddressSync(
    tokenMint,
    rewardVaultPda,
    true
  );
  const tokenBalance = new anchor.BN(
    (
      await provider.connection.getTokenAccountBalance(depositorTokenAccount)
    ).value.amount
  );
  if (tokenBalance.lt(new anchor.BN(1_000))) {
    const initialAmount = 1_000_000;
    await mintTo(
      provider.connection,
      wallet.payer,
      tokenMint,
      depositorTokenAccount,
      provider.publicKey,
      initialAmount,
      [],
      { commitment: "confirmed" }
    );
  }
  const projectId = anchor.web3.Keypair.generate();
  // deposit tokens
  {
    const amount = new anchor.BN(10);
    const expirationTime = new anchor.BN(Math.round(Date.now() / 1000 + 600));
    const depositId = anchor.web3.Keypair.generate();
    const [projectVaultPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [
        Buffer.from("project_vault"),
        projectId.publicKey.toBuffer(),
        tokenMint.toBuffer(),
      ],
      program.programId
    );
    const signature = new Array(64).fill(0);
    const txId = await program.methods
      .deposit({
        projectId: projectId.publicKey,
        depositId: depositId.publicKey,
        amount,
        expirationTime,
        signature,
      })
      .accountsPartial({
        rewardVault: rewardVaultPda,
        depositor: depositor.publicKey,
        tokenMint,
        depositorTokenAccount,
        vaultTokenAccount,
      })
      .signers([depositor])
      .rpc({ commitment: "confirmed" });
  }

  // withdraw tokens
  {
    const amount = new anchor.BN(10);
    const recipient = wallet.payer;
    const recipientTokenAccount = (
      await getOrCreateAssociatedTokenAccount(
        provider.connection,
        wallet.payer,
        tokenMint,
        recipient.publicKey,
        true,
        "confirmed"
      )
    ).address;
    const signature = new Array(64).fill(0);
    const expirationTime = new anchor.BN(Math.round(Date.now() / 1000 + 600));

    const withdrawalId = anchor.web3.Keypair.generate();
    const txId = await program.methods
      .withdraw({
        projectId: projectId.publicKey,
        withdrawalId: withdrawalId.publicKey,
        amount,
        expirationTime,
        signature,
      })
      .accountsPartial({
        rewardVault: rewardVaultPda,
        recipient: recipient.publicKey,
        tokenMint,
        recipientTokenAccount,
        vaultTokenAccount,
      })
      .rpc({ commitment: "confirmed" });
  }
};
