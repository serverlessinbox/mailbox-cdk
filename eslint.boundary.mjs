import ts from 'typescript-eslint';

// Zone boundary of packages/mailbox (core / platform / resources) and the kit.
// Patterns match the import specifier text, so each rule is written against the
// specifier forms the files use: relative paths and the package name. Exceptions
// are regex lookaheads because a gitignore-style group cannot re-include a file
// below an excluded directory.

const platformOnlyLambdas = [
  'artifact-updater-lambda',
  'license-refresher-lambda',
  'resource-sweeper-starter-lambda',
  'resource-sweeper-worker-lambda',
  'stack-failure-detector-lambda',
  'stack-update-api-lambda',
  'support-api-lambda',
  'support-role-assumption-collector-lambda',
];

const platformOnlyEvents = ['license-refresh-schedule'];

const platformListFiles = [
  ...platformOnlyLambdas.map((name) => `resources/lambdas/${name}.ts`),
  ...platformOnlyEvents.map((name) => `resources/events/${name}.ts`),
  'resources/workflows/sweeper-workflow.ts',
];

const platformListBasenames = [...platformOnlyLambdas, ...platformOnlyEvents, 'sweeper-workflow'];

// Contract files a platform file takes from the rest of mailbox: path below
// src/ without extension.
const contractFiles = ['core/apis/addons', 'resources/tables/data-tables', 'resources/queues/audit-events-queue', 'resources/lambdas/identity-provisioner-lambda'];

const mailboxSrc = 'packages/mailbox/src';
const kitSrc = 'packages/mailbox-cdk-shared/src';
const outsideRules = ['**/__tests__/**', '**/runtime/**'];

const noPlatformFromCore = {
  group: ['**/platform/**'],
  message: 'core never imports platform (rule 1).',
};

const noPlatformListFile = {
  group: platformListBasenames.map((name) => `**/${name}`),
  message: 'only platform files and the platform list import a platform-list file (rule 2).',
};

const zoneImportsAreTypeOnly = {
  regex: '(^|/)(core/(?!auth/types$)|platform/)',
  allowTypeImports: true,
  message: 'resources import core and platform files only with import type (rule 5).',
};

// Platform files (under platform/) name the rest of mailbox by zone folder.
const allowedResourceFiles = [...contractFiles.filter((file) => file.startsWith('resources/')).map((file) => file.slice('resources/'.length)), ...platformListFiles.map((file) => file.slice('resources/'.length, -'.ts'.length))];

const platformImportsOnlyContracts = {
  regex: `(^|/)(core/(?!apis/addons$)|resources/(?!(${allowedResourceFiles.join('|')})$))`,
  message: 'platform imports the rest of mailbox only through the four contract files (rule 3).',
};

// Platform-list files sit in resources/ and name the rest of mailbox by
// relative path: a sibling (./x) or a parent folder (../x, ../../x).
const platformListImportsOnlyContracts = {
  regex: '^(?!\\./identity-provisioner-lambda$|\\.\\./tables/data-tables$|\\.\\./queues/audit-events-queue$|\\.\\./events/license-refresh-schedule$|\\.\\./\\.\\./core/apis/addons$|\\.\\./\\.\\./platform/|\\.\\./\\.\\./utils/|\\.\\./\\.\\./runtime/)\\.\\.?/',
  message: 'platform-list files import the rest of mailbox only through the four contract files (rule 3).',
};

const noMailboxFromKit = [
  { group: ['@serverlessinbox/mailbox', '@serverlessinbox/mailbox/**'], message: 'the kit never imports the mailbox package (rule 4).' },
  { regex: '(^|/)packages/mailbox(/|$)|^(\\.\\./)+mailbox(/|$)', message: 'the kit never imports a packages/mailbox path (rule 4).' },
];

export const boundaryConfig = [
  {
    files: [`${mailboxSrc}/**/*.ts`, `${kitSrc}/**/*.ts`],
    languageOptions: { parser: ts.parser },
    linterOptions: { noInlineConfig: true, reportUnusedDisableDirectives: 'error' },
  },
  {
    files: [`${mailboxSrc}/core/**/*.ts`],
    ignores: outsideRules,
    rules: { 'no-restricted-imports': ['error', { patterns: [noPlatformFromCore, noPlatformListFile] }] },
  },
  {
    files: [`${mailboxSrc}/resources/**/*.ts`],
    ignores: [...outsideRules, ...platformListFiles.map((path) => `${mailboxSrc}/${path}`)],
    rules: { 'no-restricted-imports': ['error', { patterns: [noPlatformListFile, zoneImportsAreTypeOnly] }] },
  },
  {
    files: platformListFiles.map((path) => `${mailboxSrc}/${path}`),
    ignores: outsideRules,
    rules: { 'no-restricted-imports': ['error', { patterns: [platformListImportsOnlyContracts] }] },
  },
  {
    files: [`${mailboxSrc}/platform/**/*.ts`],
    ignores: outsideRules,
    rules: { 'no-restricted-imports': ['error', { patterns: [platformImportsOnlyContracts] }] },
  },
  {
    files: [`${kitSrc}/**/*.ts`],
    ignores: outsideRules,
    rules: { 'no-restricted-imports': ['error', { patterns: noMailboxFromKit }] },
  },
];
