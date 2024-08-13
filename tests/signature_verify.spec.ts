import * as anchor from "@coral-xyz/anchor";
import { ethers } from "ethers";
import { PublicKey, Keypair } from "@solana/web3.js";
import secp256k1 from "secp256k1";
import { generatePlainSignature } from "./test_helper";

describe("signature verification", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const wallet = provider.wallet as anchor.Wallet;

  it("signature verification by secp256k1", async () => {
    let plaintext = Buffer.from("string address");
    let plaintextHash = ethers.getBytes(ethers.keccak256(plaintext));

    // Create a Ethereum Address from secp256k1
    let secp256k1PrivateKey;
    do {
      secp256k1PrivateKey = anchor.web3.Keypair.generate().secretKey.slice(
        0,
        32
      );
    } while (!secp256k1.privateKeyVerify(secp256k1PrivateKey));

    let secp256k1PublicKey = secp256k1
      .publicKeyCreate(secp256k1PrivateKey, false)
      .slice(1);
    let ethAddress =
      anchor.web3.Secp256k1Program.publicKeyToEthAddress(secp256k1PublicKey);
    let { signature, recid: recoveryId } = secp256k1.ecdsaSign(
      plaintextHash,
      secp256k1PrivateKey
    );

    const txs = new anchor.web3.Transaction().add(
      // Secp256k1 instruction
      anchor.web3.Secp256k1Program.createInstructionWithEthAddress({
        ethAddress: ethAddress.toString("hex"), // E: Cannot find name 'eth_address'.
        message: plaintext, // E: Cannot find name 'actual_message'.
        signature, // E: Cannot find name 'signature'.
        recoveryId, // E: Cannot find name 'recoveryId'.
      })
    );
    const txId = await provider.connection.sendTransaction(txs, [wallet.payer]);
  });

  it("signature verification using ethers", async () => {
    const { ethAddress, actualMessage, signature, recoveryId } =
      await generatePlainSignature();
    const txs = new anchor.web3.Transaction().add(
      // Secp256k1 instruction
      anchor.web3.Secp256k1Program.createInstructionWithEthAddress({
        ethAddress, // E: Cannot find name 'eth_address'.
        message: actualMessage, // E: Cannot find name 'actual_message'.
        signature, // E: Cannot find name 'signature'.
        recoveryId, // E: Cannot find name 'recoveryId'.
      })
    );
    const txId = await provider.connection.sendTransaction(txs, [wallet.payer]);
  });
});
