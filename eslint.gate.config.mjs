import { readdirSync } from 'node:fs';

import base from './eslint.config.mjs';

// Paths the CI lint gate covers: a package joins by adding its path here once
// `yarn eslint <path>` reports nothing under eslint.config.mjs.
const joinedPaths = ['packages/mailbox-admin-api', 'packages/mailbox-bundler'];

const candidatePaths = ['scripts', ...readdirSync('packages').map((name) => `packages/${name}`)];

export default [
  ...base,
  {
    ignores: candidatePaths.filter((path) => !joinedPaths.includes(path)).map((path) => `${path}/**`),
  },
];
