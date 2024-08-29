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
  createWrappedNativeAccount,
  NATIVE_MINT,
} from "@solana/spl-token";

async function main() {
  const provider = anchor.AnchorProvider.local("https://api.devnet.solana.com");
  // Configure client to use the provider.
  anchor.setProvider(provider);
  const wallet = provider.wallet as anchor.Wallet;
  const connection = provider.connection;

  const program = new Program<RewardVaultSol>(idl as RewardVaultSol);
  const depositor = wallet.payer;
  const [rewardVaultPda] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from("reward_vault")],
    program.programId
  );

  // deposit native tokens to vault
  // 1 wsol
  const depositorWrappedNativeAccount = await getAssociatedTokenAddressSync(
    NATIVE_MINT,
    depositor.publicKey,
    true
  );
  if ((await connection.getBalance(depositorWrappedNativeAccount)) === 0) {
    const initWrappedNativeAmount = 1 * anchor.web3.LAMPORTS_PER_SOL;
    const depositorWrappedNativeAccount = await createWrappedNativeAccount(
      provider.connection,
      wallet.payer,
      depositor.publicKey,
      initWrappedNativeAmount
    );
  }
  const vaultWrappedNativeAccount = await getAssociatedTokenAddressSync(
    NATIVE_MINT,
    rewardVaultPda,
    true
  );

  {
    const amount = new anchor.BN(10);
    const expirationTime = new anchor.BN(Math.round(Date.now() / 1000 + 600));
    await program.methods
      .deposit({
        projectId: new anchor.BN(0),
        depositId: new anchor.BN(0),
        amount,
        expirationTime,
      })
      .accountsPartial({
        rewardVault: rewardVaultPda,
        depositor: depositor.publicKey,
        admin: wallet.publicKey,
        tokenMint: NATIVE_MINT,
        depositorTokenAccount: depositorWrappedNativeAccount,
        vaultTokenAccount: vaultWrappedNativeAccount,
      })
      .rpc();

    const wrappedNativeBalance = new anchor.BN(
      (
        await provider.connection.getTokenAccountBalance(
          depositorWrappedNativeAccount
        )
      ).value.amount
    );
    const vaultWrappedNativeBalance = new anchor.BN(
      (
        await provider.connection.getTokenAccountBalance(
          vaultWrappedNativeAccount
        )
      ).value.amount
    );
    console.log("wrappedNativeBalance: ", wrappedNativeBalance.toString());
    console.log(
      "vaultWrappedNativeBalance: ",
      vaultWrappedNativeBalance.toString()
    );
  }

  {
    // withdraw after deposit
    const amount = new anchor.BN(10);
    const expirationTime = new anchor.BN(Math.round(Date.now() / 1000 + 600));
    await program.methods
      .withdraw({
        projectId: new anchor.BN(0),
        withdrawalId: new anchor.BN(0),
        amount,
        expirationTime,
      })
      .accountsPartial({
        rewardVault: rewardVaultPda,
        recipient: depositor.publicKey,
        tokenMint: NATIVE_MINT,
        admin: wallet.publicKey,
        recipientTokenAccount: depositorWrappedNativeAccount,
        vaultTokenAccount: vaultWrappedNativeAccount,
      })
      .rpc();

    const wrappedNativeBalance = new anchor.BN(
      (
        await provider.connection.getTokenAccountBalance(
          depositorWrappedNativeAccount
        )
      ).value.amount
    );
    const vaultWrappedNativeBalance = new anchor.BN(
      (
        await provider.connection.getTokenAccountBalance(
          vaultWrappedNativeAccount
        )
      ).value.amount
    );
    console.log("wrappedNativeBalance: ", wrappedNativeBalance.toString());
    console.log(
      "vaultWrappedNativeBalance: ",
      vaultWrappedNativeBalance.toString()
    );
  }
}

main();
