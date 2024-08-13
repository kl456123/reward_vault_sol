import { ethers, BaseWallet } from "ethers";
import * as borsh from "@coral-xyz/borsh";
import nacl from "tweetnacl";
import { PublicKey, Keypair } from "@solana/web3.js";
import * as web3 from "@solana/web3.js";

export interface DepositData {
  depositId: BigInt;
  projectId: BigInt;
  token: string;
  amount: BigInt;
  expireTime: BigInt;
}

export interface WithdrawalData {
  withdrawId: bigint;
  projectId: bigint;
  token: string;
  amount: bigint;
  recipient: string;
  expireTime: bigint;
}

export interface ClaimData {
  claimId: bigint;
  projectId: bigint;
  token: string;
  amount: bigint;
  recipient: string;
  expireTime: bigint;
}

export enum ActionType {
  Deposit,
  Withdraw,
  Claim,
}

export async function generateTypedSignature(
  actionType: ActionType,
  value: DepositData | WithdrawalData | ClaimData,
  signer: BaseWallet,
  verifyingContract: string,
  chainId: bigint
) {
  let types;
  switch (actionType) {
    case ActionType.Claim: {
      types = {
        ClaimData: [
          { name: "claimId", type: "uint256" },
          { name: "projectId", type: "uint256" },
          { name: "token", type: "address" },
          { name: "amount", type: "uint256" },
          { name: "recipient", type: "address" },
          { name: "expireTime", type: "uint256" },
        ],
      };
      break;
    }
    case ActionType.Deposit: {
      types = {
        DepositData: [
          { name: "depositId", type: "uint256" },
          { name: "projectId", type: "uint256" },
          { name: "token", type: "address" },
          { name: "amount", type: "uint256" },
          { name: "expireTime", type: "uint256" },
        ],
      };
      break;
    }
    case ActionType.Withdraw: {
      types = {
        WithdrawalData: [
          { name: "withdrawId", type: "uint256" },
          { name: "projectId", type: "uint256" },
          { name: "token", type: "address" },
          { name: "amount", type: "uint256" },
          { name: "recipient", type: "address" },
          { name: "expireTime", type: "uint256" },
        ],
      };
    }
  }

  const domain = {
    name: "binance reward vault",
    version: "0.1.0",
    chainId,
    verifyingContract,
  };

  const signature = await signer.signTypedData(domain, types, value);
  const digest = ethers.TypedDataEncoder.encode(domain, types, value);

  return { signature, digest };
}

export function getTxCostInETH(txRecipt: {
  gasUsed: bigint;
  gasPrice: bigint;
}) {
  return txRecipt.gasUsed * txRecipt.gasPrice;
}

/// secp256k1
export async function generateETHTypedSignatureOnSolana(
  actionType: ActionType,
  value: DepositData | WithdrawalData | ClaimData,
  signer: BaseWallet,
  verifyingContract: string,
  chainId: bigint
) {
  const equipPlayerSchema = borsh.struct([
    borsh.u64("projectId"),
    borsh.u64("depositId"),
    borsh.u64("amount"),
    borsh.i64("expirationTime"),
  ]);

  const buffer = Buffer.alloc(1000);
  equipPlayerSchema.encode(value as DepositData, buffer);
  const digest = buffer.slice(0, equipPlayerSchema.getSpan(buffer));
  const signature = signer.signingKey.sign(ethers.keccak256(digest)).serialized;
  return { signature, digest };
}

/// ed25519
export async function generateTypedSignatureOnSolana(
  actionType: ActionType,
  value: any,
  signer: Keypair,
  verifyingContract: string,
  chainId: bigint
) {
  const equipPlayerSchema = borsh.struct([
    borsh.u64("projectId"),
    borsh.u64("depositId"),
    borsh.u64("amount"),
    borsh.i64("expirationTime"),
    borsh.publicKey("tokenMint"),
  ]);

  const buffer = Buffer.alloc(1000);
  equipPlayerSchema.encode(value, buffer);
  const digest = Uint8Array.from(
    buffer.slice(0, equipPlayerSchema.getSpan(buffer))
  );
  const signature = nacl.sign.detached(digest, signer.secretKey);
  return { signature, digest };
}
