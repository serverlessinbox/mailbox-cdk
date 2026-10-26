import { RuleTester }                             from '@typescript-eslint/rule-tester';
import { posix }                                  from 'node:path';
import typescriptEslint                           from 'typescript-eslint';

import { zoneMatrix }                             from '../../zones/mailbox-zones';
import type { ImporterZone, TargetZone, Verdict } from '../../zones/mailbox-zones';
import { zoneImports }                            from '../zone-imports';

// One importing file per importer zone, one target file per target zone. Each matrix cell becomes one
// RuleTester case: a value import is invalid for forbid and typeOnly cells and valid for allow cells;
// typeOnly cells also get an import type case that is valid.

const importerFiles: Record<ImporterZone, string> = {
  core:            'packages/mailbox/src/core/fixture/importer.ts',
  platform:        'packages/mailbox/src/platform/fixture/importer.ts',
  'platform-list': 'packages/mailbox/src/resources/workflows/sweeper-workflow.ts',
  resources:       'packages/mailbox/src/resources/tables/importer.ts',
  contracts:       'packages/mailbox/src/contracts/importer.ts',
  other:           'packages/mailbox/src/utils/importer.ts',
};

const targetFiles: Record<TargetZone, string> = {
  'core-addons':         'packages/mailbox/src/core/apis/addons.ts',
  'core-auth-types':     'packages/mailbox/src/core/auth/types.ts',
  core:                  'packages/mailbox/src/core/g4-core.ts',
  platform:              'packages/mailbox/src/platform/g4-platform.ts',
  'platform-list':       'packages/mailbox/src/resources/lambdas/support-api-lambda.ts',
  'platform-list-event': 'packages/mailbox/src/resources/events/stack-failed-event.ts',
  'contract-resource':   'packages/mailbox/src/resources/tables/data-tables.ts',
  resources:             'packages/mailbox/src/resources/tables/g4-other-table.ts',
  contracts:             'packages/mailbox/src/contracts/auth-names.ts',
  'utils-runtime':       'packages/mailbox/src/utils/g4-util.ts',
  other:                 'packages/mailbox/src/mailbox-props.ts',
  foreign:               'packages/mailbox-cognito/src/g4-x.ts',
};

type CellCase = {
  readonly importer:  ImporterZone;
  readonly target:    TargetZone;
  readonly filename:  string;
  readonly specifier: string;
};

const relativeSpecifier = (fromFile: string, toFile: string): string => {
  const specifier = posix.relative(posix.dirname(fromFile), toFile.replace(/\.ts$/, ''));

  return specifier.startsWith('.') ? specifier : `./${specifier}`;
};

const importCode = (specifier: string, isTypeOnly: boolean): string =>
  `${isTypeOnly ? 'import type' : 'import'} { value } from '${specifier}';`;

const cellsWith = (verdict: Verdict): CellCase[] =>
  zoneMatrix
    .filter(([, , cellVerdict]) => cellVerdict === verdict)
    .map(([importer, target]) => {
      const filename = importerFiles[importer];

      return { importer, target, filename, specifier: relativeSpecifier(filename, targetFiles[target]) };
    });

const cellValid = cellsWith('allow').map(({ importer, target, filename, specifier }) => ({
  name: `${importer} imports ${target}`,
  filename,
  code: importCode(specifier, false),
}));

const typeOnlyValid = cellsWith('typeOnly').map(({ importer, target, filename, specifier }) => ({
  name: `${importer} imports type ${target}`,
  filename,
  code: importCode(specifier, true),
}));

const cellForbidden = cellsWith('forbid').map(({ importer, target, filename, specifier }) => ({
  name:   `${importer} never imports ${target}`,
  filename,
  code:   importCode(specifier, false),
  errors: [{ messageId: 'forbidden' as const }],
}));

const cellTypeOnlyViolation = cellsWith('typeOnly').map(({ importer, target, filename, specifier }) => ({
  name:   `${importer} imports value ${target} only with import type`,
  filename,
  code:   importCode(specifier, false),
  errors: [{ messageId: 'typeOnly' as const }],
}));

const forbiddenCell = cellsWith('forbid')[0];
const typeOnlyCell  = cellsWith('typeOnly')[0];

const explicitValid = [
  {
    name:     'a named import of a platform-list file is not checked',
    filename: importerFiles['platform-list'],
    code:     "import { value } from '@serverlessinbox/mailbox/resources/lambdas/support-api-lambda';",
  },
  {
    name:     'a file in a __tests__ folder is exempt',
    filename: 'packages/mailbox/src/resources/tables/__tests__/x.test.ts',
    code:     "import { value } from '../../../platform/x';",
  },
  {
    name:     'a file of the kit package is not checked by this rule',
    filename: 'packages/mailbox-cdk-shared/src/x.ts',
    code:     "import { value } from '@serverlessinbox/mailbox/platform/x';",
  },
  {
    name:     `an export type of a typeOnly cell (${typeOnlyCell.importer} to ${typeOnlyCell.target}) is allowed`,
    filename: typeOnlyCell.filename,
    code:     `export type { value } from '${typeOnlyCell.specifier}';`,
  },
  {
    name:     'an export without a source is not an import',
    filename: importerFiles.core,
    code:     'const value = 1; export { value };',
  },
];

const explicitInvalid = [
  {
    name:     'a named import from core to platform is forbidden',
    filename: importerFiles.core,
    code:     "import { value } from '@serverlessinbox/mailbox/platform/x';",
    errors:   [{ messageId: 'forbidden' as const }],
  },
  {
    name:     'an export from resources of a platform-list file is forbidden',
    filename: importerFiles.resources,
    code:     "export { value } from '../../resources/lambdas/support-api-lambda';",
    errors:   [{ messageId: 'forbidden' as const }],
  },
  {
    name:     `an export * of a forbidden cell (${forbiddenCell.importer} to ${forbiddenCell.target}) is forbidden`,
    filename: forbiddenCell.filename,
    code:     `export * from '${forbiddenCell.specifier}';`,
    errors:   [{ messageId: 'forbidden' as const }],
  },
  {
    name:     `an export of a value of a typeOnly cell (${typeOnlyCell.importer} to ${typeOnlyCell.target}) needs export type`,
    filename: typeOnlyCell.filename,
    code:     `export { value } from '${typeOnlyCell.specifier}';`,
    errors:   [{ messageId: 'typeOnly' as const }],
  },
];

const tester = new RuleTester({
  languageOptions: { parser: typescriptEslint.parser },
});

tester.run('zone-imports', zoneImports, {
  valid:   [...cellValid, ...typeOnlyValid, ...explicitValid],
  invalid: [...cellForbidden, ...cellTypeOnlyViolation, ...explicitInvalid],
});
