import ts from 'typescript-eslint';
import base from './eslint.config.mjs';
import { boundaryConfig } from './eslint.boundary.mjs';
import { modelConfig } from './eslint.model.mjs';

// Paths the CI lint gate covers with the full rule set: a package joins by adding
// its path here once `yarn eslint <path>` reports nothing under eslint.config.mjs.
const joinedPaths = ['packages/mailbox-admin-api', 'packages/mailbox-bundler'];

// Base entries that carry `files` apply to the joined paths only (a glob already
// rooted at packages/ is kept as written); entries without `files`, the global
// ignores, stay global.
const scopedBase = base.map((entry) => {
  if (!entry.files) {
    return entry;
  }

  return {
    ...entry,
    files: entry.files.flatMap((glob) => (glob.startsWith('packages/') ? [glob] : joinedPaths.map((path) => `${path}/${glob}`))),
  };
});

// The alignment rule applies to every package, joined or not. It reuses the base `mailbox`
// plugin object because flat config rejects a second, different object under one name.
const mailboxPlugin = base.find((entry) => entry.plugins && entry.plugins.mailbox).plugins.mailbox;

const alignEverywhere = {
  files: ['**/*.ts'],
  languageOptions: { parser: ts.parser },
  plugins: { mailbox: mailboxPlugin },
  rules: { 'mailbox/align': 'error' },
};

export default [...scopedBase, alignEverywhere, ...boundaryConfig, ...modelConfig];
