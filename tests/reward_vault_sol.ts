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
  const authority = Keypair.generate();
  const signer = Keypair.generate();
  // setup reward vault
  const [rewardVaultPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("reward_vault")],
    program.programId
  );

  it("transfer ownership", async () => {
    await program.methods
      .initialize()
      .accountsPartial({
        rewardVault: rewardVaultPda,
        authority: authority.publicKey,
        payer: wallet.publicKey,
      })
      .rpc();
    {
      const rewardVault = await program.account.rewardVault.fetch(
        rewardVaultPda
      );
      expect(rewardVault.authority.equals(authority.publicKey)).to.be.true;
    }

    await program.methods
      .transferOwnership()
      .accountsPartial({
        rewardVault: rewardVaultPda,
        newAdmin: wallet.publicKey,
        admin: authority.publicKey,
        payer: wallet.publicKey,
      })
      .signers([authority])
      .rpc();
    {
      const rewardVault = await program.account.rewardVault.fetch(
        rewardVaultPda
      );
      expect(rewardVault.authority.equals(wallet.publicKey)).to.be.true;
    }
    // reset admin
    await program.methods
      .transferOwnership()
      .accountsPartial({
        rewardVault: rewardVaultPda,
        newAdmin: authority.publicKey,
        admin: wallet.publicKey,
        payer: wallet.publicKey,
      })
      .rpc();
    {
      const rewardVault = await program.account.rewardVault.fetch(
        rewardVaultPda
      );
      expect(rewardVault.authority.equals(authority.publicKey)).to.be.true;
    }
  });

  it("config signer", async () => {
    // empty
    expect(
      (await program.account.rewardVault.fetch(rewardVaultPda)).signers.length
    ).to.eq(0);

    await program.methods
      .configSigner(true)
      .accountsPartial({
        rewardVault: rewardVaultPda,
        signer: signer.publicKey,
        admin: authority.publicKey,
      })
      .signers([authority])
      .rpc();

    {
      // check result
      const rewardVault = await program.account.rewardVault.fetch(
        rewardVaultPda
      );
      expect(rewardVault.signers.length).to.eq(1);
      expect(rewardVault.signers[0].equals(signer.publicKey)).to.be.true;
    }

    // remove it after add
    await program.methods
      .configSigner(false)
      .accountsPartial({
        rewardVault: rewardVaultPda,
        signer: signer.publicKey,
        admin: authority.publicKey,
      })
      .signers([authority])
      .rpc();

    {
      // check result
      const rewardVault = await program.account.rewardVault.fetch(
        rewardVaultPda
      );
      expect(rewardVault.signers.length).to.eq(0);
    }

    await program.methods
      .configSigner(true)
      .accountsPartial({
        rewardVault: rewardVaultPda,
        signer: signer.publicKey,
        admin: authority.publicKey,
      })
      .signers([authority])
      .rpc();
  });

  it("deposit and withdraw test", async () => {
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
    const projectId = new anchor.BN(0);

    // deposit to reward vault
    {
      const amount = new anchor.BN(20);
      const expirationTime = new anchor.BN(Math.round(Date.now() / 1000 + 600));
      const depositId = new anchor.BN(0);
      const txId = await program.methods
        .deposit({
          projectId,
          depositId,
          amount,
          expirationTime,
        })
        .accountsPartial({
          rewardVault: rewardVaultPda,
          depositor: depositor.publicKey,
          tokenMint,
          admin: signer.publicKey,
          depositorTokenAccount,
          vaultTokenAccount,
        })
        .signers([depositor, signer])
        .rpc();

      // check event
      const tx = await connection.getTransaction(txId, {
        commitment: "confirmed",
      });
      const eventParser = new EventParser(
        program.programId,
        new BorshCoder(program.idl)
      );
      const events = eventParser.parseLogs(tx.meta.logMessages);
      for (const event of events) {
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
            admin: signer.publicKey,
            tokenMint: NATIVE_MINT,
            depositorTokenAccount: depositorWrappedNativeAccount,
            vaultTokenAccount: vaultWrappedNativeAccount,
          })
          .signers([depositor, signer])
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
        expect(wrappedNativeBalance.add(amount).toNumber()).to.eq(
          initWrappedNativeAmount
        );
        expect(vaultWrappedNativeBalance.eq(amount)).to.be.true;
      }
    }

    // withdraw from vault
    {
      const amount = new anchor.BN(10);
      const withdrawalId = new anchor.BN(0);
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
          projectId,
          withdrawalId,
          amount,
          expirationTime,
        })
        .accountsPartial({
          rewardVault: rewardVaultPda,
          recipient: recipient.publicKey,
          tokenMint,
          admin: signer.publicKey,
          recipientTokenAccount,
          vaultTokenAccount,
        })
        .signers([signer])
        .rpc();

      // check event
      const tx = await connection.getTransaction(txId, {
        commitment: "confirmed",
      });
      const eventParser = new EventParser(
        program.programId,
        new BorshCoder(program.idl)
      );
      const events = eventParser.parseLogs(tx.meta.logMessages);
      for (const event of events) {
        expect(event.name).to.eq("tokenWithdrawed");
        expect(event.data.projectId.eq(projectId)).to.be.true;
        expect(event.data.withdrawalId.eq(withdrawalId)).to.be.true;
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
            admin: signer.publicKey,
            recipientTokenAccount: recipientWrappedNativeAccount,
            vaultTokenAccount: vaultWrappedNativeAccount,
          })
          .signers([signer])
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

    // claim from vault
    {
      const amount = new anchor.BN(10);
      const claimId = new anchor.BN(0);
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
        .claim({
          projectId,
          claimId,
          amount,
          expirationTime,
        })
        .accountsPartial({
          rewardVault: rewardVaultPda,
          recipient: recipient.publicKey,
          tokenMint,
          admin: signer.publicKey,
          recipientTokenAccount,
          vaultTokenAccount,
        })
        .signers([signer])
        .rpc();

      // check event
      const tx = await connection.getTransaction(txId, {
        commitment: "confirmed",
      });
      const eventParser = new EventParser(
        program.programId,
        new BorshCoder(program.idl)
      );
      const events = eventParser.parseLogs(tx.meta.logMessages);
      for (const event of events) {
        expect(event.name).to.eq("tokenClaimed");
        expect(event.data.projectId.eq(projectId)).to.be.true;
        expect(event.data.claimId.eq(claimId)).to.be.true;
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

      // claim wrapped native tokens from vault
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
          .claim({
            projectId: new anchor.BN(0),
            claimId: new anchor.BN(0),
            amount,
            expirationTime,
          })
          .accountsPartial({
            rewardVault: rewardVaultPda,
            recipient: recipient.publicKey,
            tokenMint: NATIVE_MINT,
            admin: signer.publicKey,
            recipientTokenAccount: recipientWrappedNativeAccount,
            vaultTokenAccount: vaultWrappedNativeAccount,
          })
          .signers([signer])
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
