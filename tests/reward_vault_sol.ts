import * as anchor from "@coral-xyz/anchor";
import { Program, BorshCoder, EventParser } from "@coral-xyz/anchor";
import { RewardVaultSol } from "../target/types/reward_vault_sol";
import { PublicKey, Keypair } from "@solana/web3.js";
import { expect } from "chai";
import {
  createMint,
  getOrCreateAssociatedTokenAccount,
  getAssociatedTokenAddressSync,
  mintTo,
} from "@solana/spl-token";

describe("reward_vault_sol", () => {
  // Configure the client to use the local cluster.
  const envProvider = anchor.AnchorProvider.env();
  const connection = new anchor.web3.Connection(
    process.env.ANCHOR_PROVIDER_URL,
    "confirmed"
  );
  const provider = new anchor.AnchorProvider(connection, envProvider.wallet, {
    commitment: "confirmed",
  });
  anchor.setProvider(provider);

  const program = anchor.workspace.RewardVaultSol as Program<RewardVaultSol>;
  // including wallet and connection
  const wallet = provider.wallet as anchor.Wallet;

  it("basic test", async () => {
    const authority = Keypair.generate();

    // setup reward vault
    const [rewardVaultPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("reward_vault")],
      program.programId
    );
    await program.methods
      .initialize()
      .accountsPartial({
        rewardVault: rewardVaultPda,
        authority: authority.publicKey,
        payer: wallet.publicKey,
      })
      .rpc();

    const rewardVault = await program.account.rewardVault.fetch(rewardVaultPda);
    expect(rewardVault.authority.equals(authority.publicKey)).to.be.true;

    // prepare tokens
    const depositor = anchor.web3.Keypair.generate();
    await provider.connection.requestAirdrop(
      depositor.publicKey,
      1 * anchor.web3.LAMPORTS_PER_SOL
    );
    const tokenMint = await createMint(
      provider.connection,
      wallet.payer,
      provider.publicKey,
      provider.publicKey,
      6
    );
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
    const initialAmount = 1_000_000;

    await mintTo(
      provider.connection,
      wallet.payer,
      tokenMint,
      depositorTokenAccount,
      provider.publicKey,
      initialAmount
    );
    const projectId = Keypair.generate();

    // deposit to reward vault
    {
      const amount = new anchor.BN(10);
      const expirationTime = new anchor.BN(Math.round(Date.now() / 1000 + 600));
      const depositId = Keypair.generate();
      const [projectVaultPda] = PublicKey.findProgramAddressSync(
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
        .rpc();

      // check event
      const tx = await connection.getTransaction(txId, {
        commitment: "confirmed",
      });
      for (const log of tx.meta.logMessages) {
        const event = program.coder.events.decode(log);
        if (event === null) continue;
        expect(event.name).to.eq("tokenDeposited");
        expect(event.data.projectId.equals(projectId)).to.be.true;
        expect(event.data.depositId.equals(depositId)).to.be.true;
        expect(event.data.token.equals(tokenMint)).to.be.true;
        expect(event.data.amount.eq(amount)).to.be.true;
        expect(event.data.signature).to.eq(signature);
      }

      const tokenBalance = (
        await provider.connection.getTokenAccountBalance(depositorTokenAccount)
      ).value.amount;
      expect(parseInt(tokenBalance)).to.eq(initialAmount - amount.toNumber());
    }

    // withdraw from vault
    {
      const amount = new anchor.BN(10);
      const recipient = anchor.web3.Keypair.generate();
      const recipientTokenAccount = (
        await getOrCreateAssociatedTokenAccount(
          provider.connection,
          wallet.payer,
          tokenMint,
          recipient.publicKey
        )
      ).address;
      const signature = new Array(64).fill(0);
      const expirationTime = new anchor.BN(Math.round(Date.now() / 1000 + 600));

      const withdrawalId = Keypair.generate();
      const tokenBalanceBefore = new anchor.BN(
        (
          await provider.connection.getTokenAccountBalance(
            recipientTokenAccount
          )
        ).value.amount
      );
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
        .rpc();

      // check event
      const txRes = await connection.getTransaction(txId, {
        commitment: "confirmed",
      });
      for (const log of txRes.meta.logMessages) {
        const event = program.coder.events.decode(log);
        if (event === null) continue;
        expect(event.name).to.eq("tokenWithdrawed");
        expect(event.data.projectId.equals(projectId)).to.be.true;
        expect(event.data.depositId.equals(withdrawalId)).to.be.true;
        expect(event.data.token.equals(tokenMint)).to.be.true;
        expect(event.data.amount.eq(amount)).to.be.true;
        expect(event.data.signature).to.eq(signature);
      }

      const tokenBalanceAfter = new anchor.BN(
        (
          await provider.connection.getTokenAccountBalance(
            recipientTokenAccount
          )
        ).value.amount
      );
      expect(tokenBalanceAfter.sub(tokenBalanceBefore).eq(amount)).to.be.true;
    }
  });
});
