module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: 'src',
  testMatch: ['**/__tests__/**/*.test.ts'],
  collectCoverageFrom: ['**/*.ts', '!**/__tests__/**'],
  transform: {
    '^.+\\.tsx?$': ['ts-jest', {
      tsconfig: {
        lib: ['es2022'],
        types: ['jest', 'node'],
        module: 'commonjs',
        noUnusedLocals: false,
        noUnusedParameters: false,
        skipLibCheck: true,
        isolatedModules: true,
      },
    }],
  },
};
