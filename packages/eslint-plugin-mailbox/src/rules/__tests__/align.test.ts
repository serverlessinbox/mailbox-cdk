import { RuleTester }   from '@typescript-eslint/rule-tester';
import typescriptEslint from 'typescript-eslint';

import { align }        from '../align';

// Pins the alignment of `=` and `:`: group membership by line adjacency, the column-80 cap, and
// the one-space gap of a lone entry. Boundary cases use names of 73 and 74 characters for `=`
// (the `=` on column 80, then one past it) and 76 and 77 characters for `:` (the value likewise).

const code = (...rows: string[]): string => rows.join('\n');

const nameOf = (length: number): string => 'a'.repeat(length);

const tester = new RuleTester({
  languageOptions: { parser: typescriptEslint.parser },
});

tester.run('align', align, {
  valid:   [
    {
      name: 'an already aligned declaration group',
      code: code('export const a      = 1;', 'export const bcd    = 2;', 'export const efghij = 3;'),
    },
    {
      name: 'a declaration over the cap with one space is left alone',
      code: `const ${nameOf(74)} = 1;`,
    },
    {
      name: 'neighbours of an over-cap declaration align with each other',
      code: code(`const ${nameOf(74)} = 1;`, 'const b   = 2;', 'const cde = 3;'),
    },
    {
      name: 'a blank line and a comment line each end a group',
      code: code('const a = 1;', '', 'const bcd = 2;', '// note', 'const efghij = 3;'),
    },
    {
      name: 'a declaration without initializer and a call end a group',
      code: code('const a = 1;', 'let b;', 'const cde = 2;', 'run();', 'const fghij = 3;'),
    },
    {
      name: 'members on one line are not a group',
      code: 'const o = { a: 1, bcd: 2 };',
    },
    {
      name: 'a value on the next line does not take part',
      code: code('const o = {', '  a:', '    1,', '  bcd: 2,', '};'),
    },
    {
      name: 'a method, a spread and a shorthand end a group',
      code: code('const o = {', '  a: 1,', '  m() {},', '  bcd: 2,', '  ...rest,', '  efghij: 3,', '  shorthand,', '  k: 4,', '};'),
    },
    {
      name: 'an aligned interface with readonly and optional members',
      code: code('interface I {', '  readonly a: string;', '  b?:         number;', '  cdef:       boolean;', '}'),
    },
  ],
  invalid: [
    {
      name:   'three consecutive export const lines align',
      code:   code('export const a = 1;', 'export const bcd = 2;', 'export const efghij = 3;'),
      output: code('export const a      = 1;', 'export const bcd    = 2;', 'export const efghij = 3;'),
      errors: [{ messageId: 'alignEquals' }, { messageId: 'alignEquals' }],
    },
    {
      name:   'a comment line between the second and third makes two groups',
      code:   code('export const a = 1;', 'export const bcd = 2;', '// note', 'export const efghij = 3;'),
      output: code('export const a   = 1;', 'export const bcd = 2;', '// note', 'export const efghij = 3;'),
      errors: [{ messageId: 'alignEquals' }],
    },
    {
      name:   'a blank line splits a declaration group',
      code:   code('const a = 1;', 'const bcd = 2;', '', 'const efghij = 3;', 'const k = 4;'),
      output: code('const a   = 1;', 'const bcd = 2;', '', 'const efghij = 3;', 'const k      = 4;'),
      errors: [{ messageId: 'alignEquals' }, { messageId: 'alignEquals' }],
    },
    {
      name:   'assignments and declarations share a group and type annotations count as left side',
      code:   code('let a: number = 1;', 'bcd = 2;', 'const efghijklmnop = 3;'),
      output: code('let a: number      = 1;', 'bcd                = 2;', 'const efghijklmnop = 3;'),
      errors: [{ messageId: 'alignEquals' }, { messageId: 'alignEquals' }],
    },
    {
      name:   'a multi-line statement with = on its first line takes part',
      code:   code('const a = {', '  x: 1,', '};', 'const bcd = 2;'),
      output: code('const a   = {', '  x: 1,', '};', 'const bcd = 2;'),
      errors: [{ messageId: 'alignEquals' }],
    },
    {
      name:   'object keys align',
      code:   code('const o = {', '  a: 1,', '  bcd: 2,', '};'),
      output: code('const o = {', '  a:   1,', '  bcd: 2,', '};'),
      errors: [{ messageId: 'alignValue' }],
    },
    {
      name:   'a comment line between object keys makes two groups',
      code:   code('const o = {', '  a: 1,', '  bcd: 2,', '  // note', '  efghij: 3,', '};'),
      output: code('const o = {', '  a:   1,', '  bcd: 2,', '  // note', '  efghij: 3,', '};'),
      errors: [{ messageId: 'alignValue' }],
    },
    {
      name:   'a blank line between object keys makes two groups',
      code:   code('const o = {', '  a: 1,', '  bcd: 2,', '', '  efghij: 3,', '  k: 4,', '};'),
      output: code('const o = {', '  a:   1,', '  bcd: 2,', '', '  efghij: 3,', '  k:      4,', '};'),
      errors: [{ messageId: 'alignValue' }, { messageId: 'alignValue' }],
    },
    {
      name:   'interface members with readonly and optional align on the colon',
      code:   code('interface I {', '  readonly a: string;', '  b?: number;', '  cdef: boolean;', '}'),
      output: code('interface I {', '  readonly a: string;', '  b?:         number;', '  cdef:       boolean;', '}'),
      errors: [{ messageId: 'alignValue' }, { messageId: 'alignValue' }],
    },
    {
      name:   'type literal members align',
      code:   code('type T = {', '  a: string;', '  bcd: number;', '};'),
      output: code('type T = {', '  a:   string;', '  bcd: number;', '};'),
      errors: [{ messageId: 'alignValue' }],
    },
    {
      name:   'a method and a spread end a group',
      code:   code('const o = {', '  a: 1,', '  bcd: 2,', '  m() {},', '  efghij: 3,', '  k: 4,', '  ...rest,', '  lmnopq: 5,', '};'),
      output: code('const o = {', '  a:   1,', '  bcd: 2,', '  m() {},', '  efghij: 3,', '  k:      4,', '  ...rest,', '  lmnopq: 5,', '};'),
      errors: [{ messageId: 'alignValue' }, { messageId: 'alignValue' }],
    },
    {
      name:   'a multi-line value ends its member on a later line and the next member joins the group',
      code:   code('const o = {', '  a: {', '    x: 1,', '  },', '  bcd: 2,', '};'),
      output: code('const o = {', '  a:   {', '    x: 1,', '  },', '  bcd: 2,', '};'),
      errors: [{ messageId: 'alignValue' }],
    },
    {
      name:   'a single declaration with extra spaces is reset to one space',
      code:   'const abc   = 1;',
      output: 'const abc = 1;',
      errors: [{ messageId: 'alignEquals' }],
    },
    {
      name:   'an equals sign on column 80 is within the cap and aligns with its neighbour',
      code:   code(`const ${nameOf(73)} = 1;`, 'const b = 2;'),
      output: code(`const ${nameOf(73)} = 1;`, `const b${' '.repeat(73)}= 2;`),
      errors: [{ messageId: 'alignEquals' }],
    },
    {
      name:   'an equals sign past column 80 is a group of its own and its neighbours align separately',
      code:   code('const a      = 1;', `const ${nameOf(74)} = 2;`, 'const bcd = 3;'),
      output: code('const a = 1;', `const ${nameOf(74)} = 2;`, 'const bcd = 3;'),
      errors: [{ messageId: 'alignEquals' }],
    },
    {
      name:   'the declarations around an over-cap destructuring get one space before their equals sign',
      code:   code(
        `const context${' '.repeat(68)}= this.resolveContext(props);`,
        `const { ${nameOf(70)} } = context;`,
        `const enabledUis${' '.repeat(65)}= { adminUi: true };`,
      ),
      output: code(
        'const context = this.resolveContext(props);',
        `const { ${nameOf(70)} } = context;`,
        'const enabledUis = { adminUi: true };',
      ),
      errors: [{ messageId: 'alignEquals' }, { messageId: 'alignEquals' }],
    },
    {
      name:   'an over-cap destructuring with extra spaces before its equals sign is reset to one space',
      code:   `const { ${nameOf(70)} }   = context;`,
      output: `const { ${nameOf(70)} } = context;`,
      errors: [{ messageId: 'alignEquals' }],
    },
    {
      name:   'an object value on column 80 is within the cap and aligns with its neighbour',
      code:   code('const o = {', `  ${nameOf(76)}: 1,`, '  b: 2,', '};'),
      output: code('const o = {', `  ${nameOf(76)}: 1,`, `  b:${' '.repeat(76)}2,`, '};'),
      errors: [{ messageId: 'alignValue' }],
    },
    {
      name:   'an object value past column 80 is a group of its own and its neighbour gets one space',
      code:   code('const o = {', `  ${nameOf(77)}: 1,`, '  b:   2,', '};'),
      output: code('const o = {', `  ${nameOf(77)}: 1,`, '  b: 2,', '};'),
      errors: [{ messageId: 'alignValue' }],
    },
    {
      name:   'an interface member value past column 80 is a group of its own and its neighbour gets one space',
      code:   code('interface I {', `  ${nameOf(77)}: string;`, '  b:   number;', '}'),
      output: code('interface I {', `  ${nameOf(77)}: string;`, '  b: number;', '}'),
      errors: [{ messageId: 'alignValue' }],
    },
    {
      name:   'a lone object value with extra spaces is reset to one space',
      code:   code('const o = {', '  a:   1,', '};'),
      output: code('const o = {', '  a: 1,', '};'),
      errors: [{ messageId: 'alignValue' }],
    },
  ],
});
