import { ethers, BaseWallet } from "ethers";
import nacl from "tweetnacl";
import {
  generateTypedSignature,
  ActionType,
  generateTypedSignatureOnSolana,
} from "../src/utils";
import { PublicKey, Keypair } from "@solana/web3.js";
import assert from "assert";

export async function generatePlainSignature() {
  const PERSON = { name: "ben", age: 49 }; // mock data
  const eth_signer = ethers.Wallet.createRandom();
  let msg_digest = ethers.getBytes(
    ethers.solidityPackedKeccak256(
      ["string", "uint16"],
      [PERSON.name, PERSON.age]
    )
  );

  // Signed message that is actually this:
  // sign(keccak256("\x19Ethereum Signed Message:\n" + len(messageHash) + messageHash)))
  const full_sig = await eth_signer.signMessage(msg_digest);

  let full_sig_bytes = ethers.getBytes(full_sig);
  const signature = full_sig_bytes.slice(0, 64);
  const recoveryId = full_sig_bytes[64] - 27;
  // ^ Why - 27? Check https://ethereum.github.io/yellowpaper/paper.pdf page 27.

  // The message we have to check against is actually this
  // "\x19Ethereum Signed Message:\n" + "32" + keccak256(msg)
  // Since we're hashing with keccak256 the msg len is always 32
  const actualMessage = Buffer.concat([
    Buffer.from("\x19Ethereum Signed Message:\n32"),
    msg_digest,
  ]);

  // Calculated Ethereum Address (20 bytes) from public key (32 bytes)
  const ethAddress = ethers.computeAddress(eth_signer.publicKey).slice(2);

  return { actualMessage, signature, ethAddress, recoveryId };
}

export async function generateEIP712Signature(
  depositData: any,
  authority: Keypair,
  tokenMint: PublicKey
) {
  // encode deposit data to digest
  const { signature, digest } = await generateTypedSignatureOnSolana(
    ActionType.Deposit,
    { ...depositData, tokenMint },
    authority,
    ethers.ZeroAddress,
    1111n
  );

  const publicKey = authority.publicKey;
  return { actualMessage: digest, signature, publicKey };
}
