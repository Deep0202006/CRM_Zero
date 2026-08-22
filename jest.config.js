/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
  testRegex: String.raw`[\\/]__tests__[\\/](?:.*[\\/])?[^\\/]+\.test\.ts$`,
  setupFilesAfterEnv: [
    '<rootDir>/scripts/harness/employee-directory-clock.cjs',
  ],
};
