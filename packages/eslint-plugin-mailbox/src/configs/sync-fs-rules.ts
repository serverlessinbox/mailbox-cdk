import type { TSESLint } from '@typescript-eslint/utils';

const syncFsFunctions: readonly string[] = [
  'readFileSync', 'writeFileSync', 'appendFileSync', 'existsSync', 'statSync', 'lstatSync', 'readdirSync', 'mkdirSync',
  'rmSync', 'rmdirSync', 'unlinkSync', 'copyFileSync', 'renameSync', 'accessSync', 'realpathSync', 'mkdtempSync',
  'symlinkSync', 'readlinkSync', 'openSync', 'closeSync', 'chmodSync', 'cpSync',
];

const syncFsMessage = 'Use fs/promises and await it (code-structure, I/O is async).';

export const syncFsRules: TSESLint.FlatConfig.Rules = {
  'no-restricted-imports': [
    'error',
    ...['fs', 'node:fs'].map((name) => ({ name, importNames: [...syncFsFunctions], message: syncFsMessage })),
  ],
};
