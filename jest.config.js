/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  // Transform @noble ESM packages (they're type:module but we need CJS)
  transformIgnorePatterns: [
    'node_modules/(?!(@noble)/)',
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
