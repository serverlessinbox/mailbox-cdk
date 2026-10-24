require('@serverlessinbox/eslint-plugin-mailbox/register');
const mailbox = require('@serverlessinbox/eslint-plugin-mailbox');
const { boundaryConfig } = require('./eslint.boundary.mjs');
const { modelConfig } = require('./eslint.model.mjs');

module.exports = [
  {
    ignores: ['lib/', 'dist/', '**/*.d.ts', '**/*.js', '.yarn/', 'remote-git/', '**/*_pb.ts', '**/generated/**', 'build/', '.pnp.cjs', '.pnp.loader.mjs'],
  },
  ...mailbox.configs.recommended({ tsconfigRootDir: __dirname, extraConfigs: [...boundaryConfig, ...modelConfig] }),
];
