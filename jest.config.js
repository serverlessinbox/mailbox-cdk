module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: 'scripts',
  testMatch: ['**/__tests__/**/*.test.ts'],
  transform: {
    '^.+\\.tsx?$': ['ts-jest', { tsconfig: '<rootDir>/../tsconfig.scripts.json' }],
  },
};
