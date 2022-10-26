module.exports = {
  client: require('ganache-cli'),
  providerOptions: {
    total_accounts: 30,
    account_keys_path: 'keys.json',
    mnemonic: 'lady sad two vacuum rail siren barrel convince rare helmet wagon approve'
  },
  skipFiles: [
    'test/Token20.sol',
    'test/Token777.sol'
  ],
  mocha: {
    grep: "@skip-on-coverage",
    invert: true
  }
};