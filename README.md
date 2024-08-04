# Reward Vault

* reward vault deployed on solana


## Prepare

* install
```bash
# install all rust dependencies
anchor build

# install all npm packages
yarn install
```


* create solana private key and save it to local
```
solana-keygen new
```

## Usage

* deploy to devnet
```bash
anchor deploy --provider.cluster devent
```

* run ts client to initialize reward vault on chain
```bash
anchor migrate
```

* run unit tests locally
```bash
anchor test
```
