/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: 'ts-jest/presets/default-esm',
  testEnvironment: 'node',
  extensionsToTreatAsEsm: ['.ts'],
  roots: ['<rootDir>/src'],
  // Engine uvozi z .js končnico (ESM) → mapiraj nazaj na .ts za ts-jest
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  transform: {
    '^.+\\.ts$': ['ts-jest', {
      useESM: true,
      tsconfig: { module: 'ESNext', moduleResolution: 'node', verbatimModuleSyntax: false },
    }],
  },
  testMatch: ['**/*.test.ts'],
};
