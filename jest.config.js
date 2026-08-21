/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
  testRegex: String.raw`[\\/]__tests__[\\/](?:.*[\\/])?[^\\/]+\.test\.ts$`,
  setupFilesAfterEnv: [
    '<rootDir>/tools/crm-graph/scripts/employee-directory-clock.cjs',
  ],
};
