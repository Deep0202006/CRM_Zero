const base = require("../../../jest.config.js");
const path = require("node:path");
const { testMatch: _testMatch, ...baseWithoutTestMatch } = base;

module.exports = {
  ...baseWithoutTestMatch,
  rootDir: path.resolve(__dirname,"../../.."),
  testRegex: String.raw`[\\/]__tests__[\\/](?:.*[\\/])?[^\\/]+\.test\.ts$`,
  setupFilesAfterEnv: [
    ...(baseWithoutTestMatch.setupFilesAfterEnv ?? []),
    path.resolve(__dirname,"employee-directory-clock.cjs"),
  ],
};
