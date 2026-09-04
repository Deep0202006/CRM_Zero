/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    '^server-only$': '<rootDir>/scripts/test/server-only.cjs',
  },
  testRegex: String.raw`[\\/]__tests__[\\/](?:.*[\\/])?[^\\/]+\.test\.ts$`,
  setupFilesAfterEnv: [
    '<rootDir>/scripts/quality/employee-directory-clock.cjs',
  ],
};
