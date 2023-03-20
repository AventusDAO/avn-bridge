module.exports = {
  skipFiles: [
    'test/Token20.sol',
    'test/Token777.sol'
  ],
  mocha: {
    grep: "@skip-on-coverage",
    invert: true
  }
};