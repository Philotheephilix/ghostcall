/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'jsdom',
  setupFilesAfterEnv: ['@testing-library/jest-dom'],
  // Transform all ESM-only packages and their nested copies under nostr-tools
  transformIgnorePatterns: [
    'node_modules/(?!(nostr-tools/node_modules/@noble|@noble|@scure|nostr-tools|@scure)/)',
  ],
  transform: {
    '^.+\\.tsx?$': ['ts-jest', {
      tsconfig: 'tsconfig.test.json',
      diagnostics: false,
    }],
    '^.+\\.js$': ['ts-jest', {
      tsconfig: 'tsconfig.test.json',
    }],
  },
  // Strip .js extensions from imports so jest can resolve .ts files
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
    // Resolve @noble subpath exports for node moduleResolution
    '^@noble/curves/ed25519(\\.js)?$': '<rootDir>/node_modules/@noble/curves/ed25519.js',
    '^@noble/curves/secp256k1(\\.js)?$': '<rootDir>/node_modules/@noble/curves/secp256k1.js',
    '^@noble/curves/stark(\\.js)?$': '<rootDir>/node_modules/@noble/curves/stark.js',
    '^@noble/ciphers/chacha(\\.js)?$': '<rootDir>/node_modules/@noble/ciphers/chacha.js',
    '^@noble/hashes/sha256$': '<rootDir>/node_modules/@noble/hashes/sha2.js',
    '^@noble/hashes/sha512$': '<rootDir>/node_modules/@noble/hashes/sha2.js',
    // @noble/hashes 2.x merged blake2s/blake2b into a single blake2.js — starknet
    // v10 still imports the old subpaths (resolved via the package exports map,
    // which the generic mapper below bypasses). Map them explicitly.
    '^@noble/hashes/blake2[sb](\\.js)?$': '<rootDir>/node_modules/@noble/hashes/blake2.js',
    '^@noble/hashes/([^.]+)$': '<rootDir>/node_modules/@noble/hashes/$1.js',
    '^@noble/hashes/([^.]+)\\.js$': '<rootDir>/node_modules/@noble/hashes/$1.js',
    // nostr-tools subpath exports
    '^nostr-tools/pure$': '<rootDir>/node_modules/nostr-tools/lib/esm/pure.js',
    '^nostr-tools/nip59$': '<rootDir>/node_modules/nostr-tools/lib/esm/nip59.js',
    '^nostr-tools/nip44$': '<rootDir>/node_modules/nostr-tools/lib/esm/nip44.js',
    // @scure/bip39 wordlist subpath exports (strip optional .js extension)
    '^@scure/bip39/wordlists/english(\\.js)?$': '<rootDir>/node_modules/@scure/bip39/wordlists/english.js',
  },
  testMatch: [
    '**/__tests__/**/*.test.ts',
    '**/__tests__/**/*.test.tsx',
  ],
  testPathIgnorePatterns: [
    '/node_modules/',
    '/.claude/worktrees/',
    '/.superpowers/',
  ],
}
