import base from './eslint.config.mjs';
import { boundaryConfig } from './eslint.boundary.mjs';

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

export default [...scopedBase, ...boundaryConfig];
