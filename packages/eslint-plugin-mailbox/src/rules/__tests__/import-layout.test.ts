// Pins the import lane: a wide import is packed within column 79, `from` of a run with a wide import
// sits on column 80, a run without one collapses to its widest line, and an exempt import is left
// as written and ends its run. The 68 and 69 character names are the boundary pair for the cap.
import { RuleTester }   from '@typescript-eslint/rule-tester';
import typescriptEslint from 'typescript-eslint';

import { importLayout } from '../import-layout';

const code = (...rows: string[]): string => rows.join('\n');

const identifierOf = (length: number): string => 'a'.repeat(length);

const gap = (count: number): string => ' '.repeat(count);

const alignErrors = (count: number): { messageId: 'alignImport' }[] => Array.from({ length: count }, (): { messageId: 'alignImport' } => ({ messageId: 'alignImport' }));

const atCap   = identifierOf(68);
const pastCap = identifierOf(69);

const kitImport = 'import { ArtifactResolver, PinnedResolver, StackIdentity, PositionHash, ApplyTags, ResourceKinds, LogicalIds } from \'./kit\';';

const kitPacked = code('import { ArtifactResolver, PinnedResolver, StackIdentity, PositionHash,', `  ApplyTags, ResourceKinds, LogicalIds }${gap(40)}from './kit';`);

const cdkLine = `import * as cdk${gap(65)}from 'aws-cdk-lib';`;

const constructsLine = `import { Construct }${gap(60)}from 'constructs';`;

const tester = new RuleTester({
  languageOptions: { parser: typescriptEslint.parser },
});

tester.run('import-layout', importLayout, {
  valid:   [
    {
      name: 'a short named import is left alone',
      code: `import { a, b } from 'x';`,
    },
    {
      name: 'a single specifier whose from starts at column 80 is left alone',
      code: `import { ${atCap} } from 'x';`,
    },
    {
      name: 'an authored multi-line import whose lines fit is kept at any width',
      code: code('import {', `  ${pastCap},`, `} from 'x';`),
    },
    {
      name: 'an aligned run with a wide import is left alone',
      code: code(cdkLine, constructsLine, kitPacked.split('\n')[0], kitPacked.split('\n')[1]),
    },
    {
      name: 'default-only and namespace-only imports are aligned in a run with a wide import',
      code: code(cdkLine, `import Def${gap(70)}from 'def';`, kitPacked.split('\n')[0], kitPacked.split('\n')[1]),
    },
    {
      name: 'an authored multi-line import is aligned to the lane of its run',
      code: code(cdkLine, 'import {', `  ${identifierOf(42)},`, `  ${'b'.repeat(42)},`, `}${gap(79)}from './x';`),
    },
    {
      name: 'an import with a comment inside the braces is left alone',
      code: `import { a, /* note */ ${pastCap} } from 'x';`,
    },
    {
      name: 'an exempt import ends its run, so the imports around it keep their own lanes',
      code: code(`import * as cdk from 'aws-cdk-lib';`, `import { a, /* note */ ${pastCap} } from 'x';`, `import { Construct } from 'constructs';`),
    },
    {
      name: 'an import whose from is on its own line is left alone',
      code: code('import { a }', `  from 'x';`),
    },
    {
      name: 'a default-only import longer than the lane is left alone',
      code: `import ${identifierOf(90)} from 'x';`,
    },
    {
      name: 'a single specifier too long for any line is left alone',
      code: `import { ${identifierOf(80)} } from 'x';`,
    },
    {
      name: 'a namespace-only import is never wrapped',
      code: `import * as ${identifierOf(90)} from 'x';`,
    },
    {
      name: 'a side-effect import is never wrapped',
      code: `import '${identifierOf(90)}';`,
    },
  ],
  invalid: [
    {
      name:   'a lone wide named import is packed and its from follows the last name with one space',
      code:   kitImport,
      output: code('import { ArtifactResolver, PinnedResolver, StackIdentity, PositionHash,', `  ApplyTags, ResourceKinds, LogicalIds } from './kit';`),
      errors: alignErrors(1),
    },
    {
      name:   'a lone wide import type keeps the type keyword in the head',
      code:   `import type { a, ${pastCap} } from 'x';`,
      output: code('import type { a,', `  ${pastCap} } from 'x';`),
      errors: alignErrors(1),
    },
    {
      name:   'a wide default import keeps the default in the head',
      code:   `import Def, { a, ${pastCap} } from 'x';`,
      output: code('import Def, { a,', `  ${pastCap} } from 'x';`),
      errors: alignErrors(1),
    },
    {
      name:   'an inline type specifier is copied verbatim',
      code:   `import { a, type ${pastCap} } from 'x';`,
      output: code('import { a,', `  type ${pastCap} } from 'x';`),
      errors: alignErrors(1),
    },
    {
      name:   'an as alias is copied verbatim',
      code:   `import { a as ${pastCap} } from 'x';`,
      output: code('import {', `  a as ${pastCap} } from 'x';`),
      errors: alignErrors(1),
    },
    {
      name:   'padding between the closing brace and from collapses to one space',
      code:   `import { a, ${pastCap} }      from 'x';`,
      output: code('import { a,', `  ${pastCap} } from 'x';`),
      errors: alignErrors(1),
    },
    {
      name:   'a trailing comma is dropped from the packed layout',
      code:   `import { a, ${pastCap}, } from 'x';`,
      output: code('import { a,', `  ${pastCap} } from 'x';`),
      errors: alignErrors(1),
    },
    {
      name:   'a single specifier whose from would start at column 81 is wrapped',
      code:   `import { ${pastCap} } from 'x';`,
      output: code('import {', `  ${pastCap} } from 'x';`),
      errors: alignErrors(1),
    },
    {
      name:   'an import inside a declare module block takes the indent of its statement',
      code:   code("declare module 'm' {", `  import { a, ${pastCap} } from 'x';`, '}'),
      output: code("declare module 'm' {", '  import { a,', `    ${pastCap} } from 'x';`, '}'),
      errors: alignErrors(1),
    },
    {
      name:   'a trailing line comment after the statement survives',
      code:   `import { a, ${pastCap} } from 'x'; // c`,
      output: code('import { a,', `  ${pastCap} } from 'x'; // c`),
      errors: alignErrors(1),
    },
    {
      name:   'a run with a wide import pads its short neighbours to the lane',
      code:   code(`import * as cdk from 'aws-cdk-lib';`, `import { Construct } from 'constructs';`, kitImport),
      output: code(cdkLine, constructsLine, kitPacked),
      errors: alignErrors(3),
    },
    {
      name:   'a run without a wide import collapses to its widest line plus one',
      code:   code(`import * as cdk${gap(8)}from 'aws-cdk-lib';`, `import { Construct }${gap(3)}from 'constructs';`),
      output: code(`import * as cdk${gap(6)}from 'aws-cdk-lib';`, `import { Construct } from 'constructs';`),
      errors: alignErrors(2),
    },
    {
      name:   'an authored one-per-line wide import keeps its shape and moves from to the lane',
      code:   code(`import * as cdk from 'aws-cdk-lib';`, 'import {', `  ${identifierOf(42)},`, `  ${'b'.repeat(42)},`, `} from './x';`),
      output: code(cdkLine, 'import {', `  ${identifierOf(42)},`, `  ${'b'.repeat(42)},`, `}${gap(79)}from './x';`),
      errors: alignErrors(2),
    },
    {
      name:   'an authored short multi-line import in a collapse run keeps its shape',
      code:   code('import {', '  a,', '  b,', `} from 'x';`, `import * as cdk from 'aws-cdk-lib';`),
      output: code('import {', '  a,', '  b,', `}${gap(15)}from 'x';`, `import * as cdk from 'aws-cdk-lib';`),
      errors: alignErrors(1),
    },
    {
      name:   'an authored multi-line import with a line past the lane is reflowed to the packed shape',
      code:   code('import {', `  ${identifierOf(40)}, ${'b'.repeat(40)}, c`, `} from 'x';`),
      output: code(`import { ${identifierOf(40)},`, `  ${'b'.repeat(40)}, c } from 'x';`),
      errors: alignErrors(1),
    },
    {
      name:   'a side-effect import splits a run into two lanes',
      code:   code(`import * as cdk${gap(8)}from 'aws-cdk-lib';`, `import 'reflect-metadata';`, `import { Construct }${gap(3)}from 'constructs';`),
      output: code(`import * as cdk from 'aws-cdk-lib';`, `import 'reflect-metadata';`, `import { Construct } from 'constructs';`),
      errors: alignErrors(2),
    },
    {
      name:   'a blank line between imports does not end the run',
      code:   code(`import * as cdk from 'aws-cdk-lib';`, '', `import { Construct }   from 'constructs';`),
      output: code(`import * as cdk${gap(6)}from 'aws-cdk-lib';`, '', `import { Construct } from 'constructs';`),
      errors: alignErrors(2),
    },
    {
      name:   'a run of one with extra spaces collapses to one space',
      code:   `import { a }      from 'x';`,
      output: `import { a } from 'x';`,
      errors: alignErrors(1),
    },
  ],
});
