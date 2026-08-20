/** Focused Windows-safe Jest configuration for CRM-P1-046-A08 proof. */
module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  rootDir: "../../..",
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/src/$1",
  },
  testRegex: ".*[\\\\/]__tests__[\\\\/].*\\.test\\.ts$",
};
