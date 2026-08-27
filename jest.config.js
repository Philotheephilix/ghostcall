/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  // Transform all ESM-only packages and their nested copies under nostr-tools
  transformIgnorePatterns: [
    'node_modules/(?!(nostr-tools/node_modules/@noble|@noble|@scure|nostr-tools)/)',
  ],
  transform: {
    '^.+\\.tsx?$': ['ts-jest', {
      tsconfig: 'tsconfig.test.json',
      diagnostics: { tsConfig: 'tsconfig.test.json' },
    }],
    '^.+\\.js$': ['ts-jest', {
      tsconfig: 'tsconfig.test.json',
    }],
  },
  // Strip .js extensions from imports so jest can resolve .ts files
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  testMatch: [
    '**/__tests__/**/*.test.ts',
  ],
}
