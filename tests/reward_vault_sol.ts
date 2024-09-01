import * as anchor from "@coral-xyz/anchor";
import {
  Program,
  BorshCoder,
  EventParser,
  AnchorError,
} from "@coral-xyz/anchor";
import { RewardVaultSol } from "../target/types/reward_vault_sol";
import { PublicKey, Keypair } from "@solana/web3.js";
import { expect } from "chai";
import { checkError } from "./test_utils";
import {
  createMint,
  getOrCreateAssociatedTokenAccount,
  getAssociatedTokenAddressSync,
  mintTo,
  createWrappedNativeAccount,
  NATIVE_MINT,
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
  const eventParser = new EventParser(
    program.programId,
    new BorshCoder(program.idl)
  );
  // including wallet and connection
  const wallet = provider.wallet as anchor.Wallet;
  const authority = Keypair.generate();
  const signer = Keypair.generate();
  // setup reward vault
  const [rewardVaultPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("reward_vault")],
    program.programId
  );

  before(async () => {
    await program.methods
      .initialize()
      .accountsPartial({
        rewardVault: rewardVaultPda,
        authority: authority.publicKey,
        payer: wallet.publicKey,
      })
      .rpc();

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

  describe("initialize test", () => {
    it("check after first initialize", async () => {
      {
        const rewardVault = await program.account.rewardVault.fetch(
          rewardVaultPda
        );
        expect(rewardVault.authority.equals(authority.publicKey)).to.be.true;
      }
    });

    it("revert when initialize again", async () => {
      await checkError(
        program.methods
          .initialize()
          .accountsPartial({
            rewardVault: rewardVaultPda,
            authority: authority.publicKey,
            payer: wallet.publicKey,
          })
          .rpc(),
        0,
        "custom program error: 0x0"
      );
    });
  });

  describe("transfer ownership test", () => {
    it("transfer ownership multiple times", async () => {
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

    it("revert when transfer ownership by invalid authority", async () => {
      const other = Keypair.generate();
      await checkError(
        program.methods
          .transferOwnership()
          .accountsPartial({
            rewardVault: rewardVaultPda,
            newAdmin: authority.publicKey,
            admin: other.publicKey,
            payer: wallet.publicKey,
          })
          .signers([other])
          .rpc(),
        6000,
        "invalid signature"
      );
    });
  });

  describe("config signer test", () => {
    it("add and remove signer", async () => {
      {
        // check result
        const rewardVault = await program.account.rewardVault.fetch(
          rewardVaultPda
        );
        expect(rewardVault.signers.length).to.eq(1);
        expect(rewardVault.signers[0].equals(signer.publicKey)).to.be.true;
      }

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

    it("revert when config signer by invalid authority", async () => {
      const other = Keypair.generate();
      await checkError(
        program.methods
          .configSigner(true)
          .accountsPartial({
            rewardVault: rewardVaultPda,
            signer: signer.publicKey,
            admin: other.publicKey,
          })
          .signers([other])
          .rpc(),
        6000,
        "invalid signature"
      );
    });

    it("revert when add duplicated signer", async () => {
      await checkError(
        program.methods
          .configSigner(true)
          .accountsPartial({
            rewardVault: rewardVaultPda,
            signer: signer.publicKey,
            admin: authority.publicKey,
          })
          .signers([authority])
          .rpc(),
        6003,
        "signer added already"
      );
    });

    it("revert when try to remove a not existed signer", async () => {
      const other = Keypair.generate();
      await checkError(
        program.methods
          .configSigner(false)
          .accountsPartial({
            rewardVault: rewardVaultPda,
            signer: other.publicKey,
            admin: authority.publicKey,
          })
          .signers([authority])
          .rpc(),
        6004,
        "signer not exist"
      );
    });
  });

  describe("deposit, claim and withdraw test", () => {
    let tokenMint: PublicKey;
    let depositor: Keypair;
    let depositorTokenAccount: PublicKey;
    let vaultTokenAccount: PublicKey;
    let vaultWrappedNativeAccount: PublicKey;
    let depositorWrappedNativeAccount: PublicKey;
    const depositedWrappedTokenAmount = new anchor.BN(200);
    const depositedSplTokenAmount = new anchor.BN(200);

    const claimableWrappedTokenAmount = new anchor.BN(20);
    const claimableSplTokenAmount = new anchor.BN(20);

    const withdrawableWrappedTokenAmount = new anchor.BN(20);
    const withdrawableSplTokenAmount = new anchor.BN(20);
    const projectId = new anchor.BN(0);

    let recipient: Keypair;
    let recipientTokenAccount: PublicKey;
    let recipientWrappedNativeAccount: PublicKey;

    before(async () => {
      // prepare tokens
      depositor = anchor.web3.Keypair.generate();
      await provider.connection.requestAirdrop(
        depositor.publicKey,
        1 * anchor.web3.LAMPORTS_PER_SOL
      );
      tokenMint = await createMint(
        provider.connection,
        wallet.payer,
        provider.publicKey,
        provider.publicKey,
        6
      );
      depositorTokenAccount = (
        await getOrCreateAssociatedTokenAccount(
          provider.connection,
          wallet.payer,
          tokenMint,
          depositor.publicKey
        )
      ).address;
      // create a ata account owned by program
      vaultTokenAccount = await getAssociatedTokenAddressSync(
        tokenMint,
        rewardVaultPda,
        true
      );
      // create a wrapped token account owned by program
      vaultWrappedNativeAccount = await getAssociatedTokenAddressSync(
        NATIVE_MINT,
        rewardVaultPda,
        true
      );

      // 1 wsol
      const initWrappedNativeAmount = 1 * anchor.web3.LAMPORTS_PER_SOL;
      depositorWrappedNativeAccount = await createWrappedNativeAccount(
        await provider.connection,
        wallet.payer,
        depositor.publicKey,
        initWrappedNativeAmount
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

      recipient = anchor.web3.Keypair.generate();
      recipientTokenAccount = (
        await getOrCreateAssociatedTokenAccount(
          provider.connection,
          wallet.payer,
          tokenMint,
          recipient.publicKey
        )
      ).address;

      recipientWrappedNativeAccount = (
        await getOrCreateAssociatedTokenAccount(
          provider.connection,
          wallet.payer,
          NATIVE_MINT,
          recipient.publicKey
        )
      ).address;
    });

    describe("deposit test", () => {
      it("deposit spl tokens", async () => {
        const tokenBalanceBefore = parseInt(
          (
            await provider.connection.getTokenAccountBalance(
              depositorTokenAccount
            )
          ).value.amount
        );

        // deposit to reward vault
        const expirationTime = new anchor.BN(
          Math.round(Date.now() / 1000 + 600)
        );
        const depositId = new anchor.BN(0);
        const txId = await program.methods
          .deposit({
            projectId,
            depositId,
            amount: depositedSplTokenAmount,
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

        const events = eventParser.parseLogs(tx.meta.logMessages);
        for (const event of events) {
          expect(event.name).to.eq("tokenDeposited");
          expect(event.data.projectId.eq(projectId)).to.be.true;
          expect(event.data.depositId.eq(depositId)).to.be.true;
          expect(event.data.token.equals(tokenMint)).to.be.true;
          expect(event.data.amount.eq(depositedSplTokenAmount)).to.be.true;
        }

        const tokenBalance = parseInt(
          (
            await provider.connection.getTokenAccountBalance(
              depositorTokenAccount
            )
          ).value.amount
        );
        expect(tokenBalance).to.eq(
          tokenBalanceBefore - depositedSplTokenAmount.toNumber()
        );
      });

      it("deposit native tokens", async () => {
        const expirationTime = new anchor.BN(
          Math.round(Date.now() / 1000 + 600)
        );
        const depositId = new anchor.BN(0);
        const wrappedNativeBalanceBefore = new anchor.BN(
          (
            await provider.connection.getTokenAccountBalance(
              depositorWrappedNativeAccount
            )
          ).value.amount
        );
        // deposit native tokens to vault
        await program.methods
          .deposit({
            projectId,
            depositId,
            amount: depositedWrappedTokenAmount,
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
        expect(
          wrappedNativeBalance
            .add(depositedWrappedTokenAmount)
            .eq(wrappedNativeBalanceBefore)
        ).to.be.true;
        expect(vaultWrappedNativeBalance.eq(depositedWrappedTokenAmount)).to.be
          .true;
      });

      it("revert when deposit using invalid signature", async () => {
        const expirationTime = new anchor.BN(
          Math.round(Date.now() / 1000 + 600)
        );
        const depositId = new anchor.BN(0);
        const other = Keypair.generate();
        await checkError(
          program.methods
            .deposit({
              projectId,
              depositId,
              amount: depositedWrappedTokenAmount,
              expirationTime,
            })
            .accountsPartial({
              rewardVault: rewardVaultPda,
              depositor: depositor.publicKey,
              admin: other.publicKey,
              tokenMint: NATIVE_MINT,
              depositorTokenAccount: depositorWrappedNativeAccount,
              vaultTokenAccount: vaultWrappedNativeAccount,
            })
            .signers([depositor, other])
            .rpc(),
          6000,
          "invalid signature"
        );
      });

      it("revert when signature expired", async () => {
        const expirationTime = new anchor.BN(
          Math.round(Date.now() / 1000 - 600)
        );
        const depositId = new anchor.BN(0);
        await checkError(
          program.methods
            .deposit({
              projectId,
              depositId,
              amount: depositedWrappedTokenAmount,
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
            .rpc(),
          6001,
          "expired signature"
        );
      });
    });

    describe("claim test", () => {
      it("claim native tokens", async () => {
        const claimId = new anchor.BN(0);
        const expirationTime = new anchor.BN(
          Math.round(Date.now() / 1000 + 600)
        );
        // claim wrapped native tokens from vault
        {
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
              projectId,
              claimId,
              amount: claimableWrappedTokenAmount,
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
              .eq(claimableWrappedTokenAmount)
          ).to.be.true;
          expect(
            vaultWrappedNativeBalanceBefore
              .sub(vaultWrappedNativeBalanceAfter)
              .eq(claimableWrappedTokenAmount)
          ).to.be.true;
        }
      });
      it("claim spl tokens", async () => {
        const amount = new anchor.BN(10);
        const claimId = new anchor.BN(0);
        const expirationTime = new anchor.BN(
          Math.round(Date.now() / 1000 + 600)
        );

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
      });

      it("revert when claim too much tokens", async () => {
        const amount = new anchor.BN(1000);
        const claimId = new anchor.BN(0);
        const expirationTime = new anchor.BN(
          Math.round(Date.now() / 1000 + 600)
        );

        await checkError(
          program.methods
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
            .rpc(),
          0,
          "insufficient funds for instruction"
        );
      });
    });

    describe("withdraw test", () => {
      it("revert when withdraw too much", async () => {
        const withdrawalId = new anchor.BN(0);
        const amount = new anchor.BN(1000);
        const expirationTime = new anchor.BN(
          Math.round(Date.now() / 1000 + 600)
        );
        await checkError(
          program.methods
            .withdraw({
              projectId,
              withdrawalId,
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
            .rpc(),
          0,
          "insufficient funds for instruction"
        );
      });

      it("withdraw native tokens", async () => {
        const withdrawalId = new anchor.BN(0);
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
        const expirationTime = new anchor.BN(
          Math.round(Date.now() / 1000 + 600)
        );
        await program.methods
          .withdraw({
            projectId,
            withdrawalId,
            amount: withdrawableWrappedTokenAmount,
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
            .eq(withdrawableWrappedTokenAmount)
        ).to.be.true;
        expect(
          vaultWrappedNativeBalanceBefore
            .sub(vaultWrappedNativeBalanceAfter)
            .eq(withdrawableWrappedTokenAmount)
        ).to.be.true;
      });

      it("withdraw spl tokens", async () => {
        {
          const withdrawalId = new anchor.BN(0);
          const expirationTime = new anchor.BN(
            Math.round(Date.now() / 1000 + 600)
          );

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
              amount: withdrawableSplTokenAmount,
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
          const events = eventParser.parseLogs(tx.meta.logMessages);
          for (const event of events) {
            expect(event.name).to.eq("tokenWithdrawed");
            expect(event.data.projectId.eq(projectId)).to.be.true;
            expect(event.data.withdrawalId.eq(withdrawalId)).to.be.true;
            expect(event.data.token.equals(tokenMint)).to.be.true;
            expect(event.data.amount.eq(withdrawableSplTokenAmount)).to.be.true;
          }

          const tokenBalanceAfter = new anchor.BN(
            (
              await provider.connection.getTokenAccountBalance(
                recipientTokenAccount
              )
            ).value.amount
          );
          expect(
            tokenBalanceAfter
              .sub(tokenBalanceBefore)
              .eq(withdrawableSplTokenAmount)
          ).to.be.true;
        }
      });
    });
  });
});
