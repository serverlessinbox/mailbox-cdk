#!/usr/bin/env node

// Run TS sources via ts-node (workspace-local, no build step required).
require('ts-node/register/transpile-only');

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { runCli } = require('../src/cli');

runCli(process.argv.slice(2)).catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
