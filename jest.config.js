const scriptsCompilerOptions = require('./tsconfig.scripts.json').compilerOptions;

module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: 'scripts',
  testMatch: ['**/__tests__/**/*.test.ts'],
  transform: {
    '^.+\\.tsx?$': ['ts-jest', { tsconfig: { ...scriptsCompilerOptions, isolatedModules: true } }],
  },
};
