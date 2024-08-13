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
  createWrappedNativeAccount,
  NATIVE_MINT,
  closeAccount,
} from "@solana/spl-token";
import { generatePlainSignature, generateEIP712Signature } from "./test_helper";

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
    // create a wrapped token account owned by program
    const vaultWrappedNativeAccount = await getAssociatedTokenAddressSync(
      NATIVE_MINT,
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
      const depositParam = {
        projectId: new anchor.BN(0),
        depositId: new anchor.BN(0),
        amount,
        expirationTime,
      };
      const { actualMessage, signature, publicKey } =
        await generateEIP712Signature(
          depositParam,
          authority,
          tokenMint,
          program.programId
        );
      const signatureParam = {
        sig: signature,
      };

      const txs = new anchor.web3.Transaction()
        .add(
          anchor.web3.Ed25519Program.createInstructionWithPublicKey({
            publicKey: publicKey.toBytes(),
            message: actualMessage,
            signature,
          })
        )
        .add(
          await program.methods
            .deposit(depositParam, signatureParam)
            .accountsPartial({
              rewardVault: rewardVaultPda,
              depositor: depositor.publicKey,
              tokenMint,
              signer: authority.publicKey,
              depositorTokenAccount,
              vaultTokenAccount,
            })
            .instruction()
        );
      const txId = await anchor.web3.sendAndConfirmTransaction(
        provider.connection,
        txs,
        [depositor],
        { commitment: "confirmed" }
      );

      // check event
      const tx = await connection.getTransaction(txId, {
        commitment: "confirmed",
      });
      for (const log of tx.meta.logMessages) {
        const event = program.coder.events.decode(log);
        if (event === null) continue;
        expect(event.name).to.eq("tokenDeposited");
        expect(event.data.projectId.eq(projectId)).to.be.true;
        expect(event.data.depositId.eq(depositId)).to.be.true;
        expect(event.data.token.equals(tokenMint)).to.be.true;
        expect(event.data.amount.eq(amount)).to.be.true;
      }

      const tokenBalance = (
        await provider.connection.getTokenAccountBalance(depositorTokenAccount)
      ).value.amount;
      expect(parseInt(tokenBalance)).to.eq(initialAmount - amount.toNumber());

      {
        // deposit native tokens to vault
        // 1 wsol
        const initWrappedNativeAmount = 1 * anchor.web3.LAMPORTS_PER_SOL;
        const depositorWrappedNativeAccount = await createWrappedNativeAccount(
          await provider.connection,
          wallet.payer,
          depositor.publicKey,
          initWrappedNativeAmount
        );
        const depositParam = {
          projectId: new anchor.BN(0),
          depositId: new anchor.BN(0),
          amount,
          expirationTime,
        };

        const { actualMessage, signature, publicKey } =
          await generateEIP712Signature(
            depositParam,
            authority,
            NATIVE_MINT,
            program.programId
          );
        const signatureParam = {
          sig: signature,
        };

        const txs = new anchor.web3.Transaction()
          .add(
            anchor.web3.Ed25519Program.createInstructionWithPublicKey({
              publicKey: publicKey.toBytes(),
              message: actualMessage,
              signature,
            })
          )
          .add(
            await program.methods
              .deposit(depositParam, signatureParam)
              .accountsPartial({
                rewardVault: rewardVaultPda,
                depositor: depositor.publicKey,
                tokenMint: NATIVE_MINT,
                signer: authority.publicKey,
                depositorTokenAccount: depositorWrappedNativeAccount,
                vaultTokenAccount: vaultWrappedNativeAccount,
              })
              .instruction()
          );
        const txId = await anchor.web3.sendAndConfirmTransaction(
          provider.connection,
          txs,
          [depositor],
          { commitment: "confirmed" }
        );
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
        expect(wrappedNativeBalance.add(amount).toNumber()).to.eq(
          initWrappedNativeAmount
        );
        expect(vaultWrappedNativeBalance.eq(amount)).to.be.true;
      }
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
      const expirationTime = new anchor.BN(Math.round(Date.now() / 1000 + 600));

      const tokenBalanceBefore = new anchor.BN(
        (
          await provider.connection.getTokenAccountBalance(
            recipientTokenAccount
          )
        ).value.amount
      );
      const txId = await program.methods
        .withdraw({
          projectId: new anchor.BN(0),
          withdrawalId: new anchor.BN(0),
          amount,
          expirationTime,
        })
        .accountsPartial({
          rewardVault: rewardVaultPda,
          recipient: recipient.publicKey,
          tokenMint,
          admin: authority.publicKey,
          recipientTokenAccount,
          vaultTokenAccount,
        })
        .signers([authority])
        .rpc();

      // check event
      const txRes = await connection.getTransaction(txId, {
        commitment: "confirmed",
      });
      for (const log of txRes.meta.logMessages) {
        const event = program.coder.events.decode(log);
        if (event === null) continue;
        expect(event.name).to.eq("tokenWithdrawed");
        expect(event.data.projectId.eq(projectId)).to.be.true;
        expect(event.data.withdrawalId.eq(0)).to.be.true;
        expect(event.data.token.equals(tokenMint)).to.be.true;
        expect(event.data.amount.eq(amount)).to.be.true;
      }

      const tokenBalanceAfter = new anchor.BN(
        (
          await provider.connection.getTokenAccountBalance(
            recipientTokenAccount
          )
        ).value.amount
      );
      expect(tokenBalanceAfter.sub(tokenBalanceBefore).eq(amount)).to.be.true;

      // withdraw wrapped native tokens from vault
      {
        const recipientWrappedNativeAccount = (
          await getOrCreateAssociatedTokenAccount(
            provider.connection,
            wallet.payer,
            NATIVE_MINT,
            recipient.publicKey
          )
        ).address;

        const recipientWrappedNativeBalanceBefore = new anchor.BN(
          (
            await provider.connection.getTokenAccountBalance(
              recipientWrappedNativeAccount
            )
          ).value.amount
        );
        const vaultWrappedNativeBalanceBefore = new anchor.BN(
          (
            await provider.connection.getTokenAccountBalance(
              vaultWrappedNativeAccount
            )
          ).value.amount
        );
        await program.methods
          .withdraw({
            projectId: new anchor.BN(0),
            withdrawalId: new anchor.BN(0),
            amount,
            expirationTime,
          })
          .accountsPartial({
            rewardVault: rewardVaultPda,
            recipient: recipient.publicKey,
            tokenMint: NATIVE_MINT,
            admin: authority.publicKey,
            recipientTokenAccount: recipientWrappedNativeAccount,
            vaultTokenAccount: vaultWrappedNativeAccount,
          })
          .signers([authority])
          .rpc();
        const recipientWrappedNativeBalanceAfter = new anchor.BN(
          (
            await provider.connection.getTokenAccountBalance(
              recipientWrappedNativeAccount
            )
          ).value.amount
        );
        const vaultWrappedNativeBalanceAfter = new anchor.BN(
          (
            await provider.connection.getTokenAccountBalance(
              vaultWrappedNativeAccount
            )
          ).value.amount
        );
        expect(
          recipientWrappedNativeBalanceAfter
            .sub(recipientWrappedNativeBalanceBefore)
            .eq(amount)
        ).to.be.true;
        expect(
          vaultWrappedNativeBalanceBefore
            .sub(vaultWrappedNativeBalanceAfter)
            .eq(amount)
        ).to.be.true;

        // unwrap wsol if necessary
        const solBalanceBefore = await provider.connection.getBalance(
          recipient.publicKey
        );
        const solATABalanceBefore = await provider.connection.getBalance(
          recipientWrappedNativeAccount
        );
        await closeAccount(
          provider.connection,
          wallet.payer,
          recipientWrappedNativeAccount,
          recipient.publicKey,
          recipient
        );
        const solATABalanceAfter = await provider.connection.getBalance(
          recipientWrappedNativeAccount
        );
        const solBalanceAfter = await provider.connection.getBalance(
          recipient.publicKey
        );
        // no any sol remained in ata, all sol are transfered to recipient account
        expect(solBalanceAfter - solBalanceBefore).eq(
          solATABalanceBefore - solATABalanceAfter
        );
        expect(solATABalanceAfter).to.eq(0);
      }
    }
  });
});
