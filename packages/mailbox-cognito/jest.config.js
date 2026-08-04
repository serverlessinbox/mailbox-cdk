module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: 'src',
  testMatch: ['**/__tests__/**/*.test.ts'],
  collectCoverageFrom: ['**/*.ts', '!**/__tests__/**', '!**/generated/**'],
  extensionsToTreatAsEsm: ['.ts'],
  globals: {
    'ts-jest': {
      useESM: true,
      tsconfig: {
        lib: ['es2022', 'dom'],
        types: ['jest', 'node'],
        noUnusedLocals: false,
        noUnusedParameters: false,
        skipLibCheck: true,
        resolveJsonModule: true,
        isolatedModules: true,
      },
    },
  },
};
