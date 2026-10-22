import { describe, it } from 'node:test';
import { RuleTester } from 'eslint';
import ts from 'typescript-eslint';
import { alignRule } from './eslint.align.mjs';

RuleTester.describe = describe;
RuleTester.it = it;

const code = (...rows) => rows.join('\n');

const tester = new RuleTester({
  languageOptions: { parser: ts.parser },
});

tester.run('custom/align', alignRule, {
  valid: [
    {
      name: 'an already aligned declaration group',
      code: code('export const a      = 1;', 'export const bcd    = 2;', 'export const efghij = 3;'),
    },
    {
      name: 'a single declaration is left alone',
      code: 'const abc   = 1;',
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
      name: 'three consecutive export const lines align',
      code: code('export const a = 1;', 'export const bcd = 2;', 'export const efghij = 3;'),
      output: code('export const a      = 1;', 'export const bcd    = 2;', 'export const efghij = 3;'),
      errors: [{ messageId: 'alignEquals' }, { messageId: 'alignEquals' }],
    },
    {
      name: 'a comment line between the second and third makes two groups',
      code: code('export const a = 1;', 'export const bcd = 2;', '// note', 'export const efghij = 3;'),
      output: code('export const a   = 1;', 'export const bcd = 2;', '// note', 'export const efghij = 3;'),
      errors: [{ messageId: 'alignEquals' }],
    },
    {
      name: 'a blank line splits a declaration group',
      code: code('const a = 1;', 'const bcd = 2;', '', 'const efghij = 3;', 'const k = 4;'),
      output: code('const a   = 1;', 'const bcd = 2;', '', 'const efghij = 3;', 'const k      = 4;'),
      errors: [{ messageId: 'alignEquals' }, { messageId: 'alignEquals' }],
    },
    {
      name: 'assignments and declarations share a group and type annotations count as left side',
      code: code('let a: number = 1;', 'bcd = 2;', 'const efghijklmnop = 3;'),
      output: code('let a: number      = 1;', 'bcd                = 2;', 'const efghijklmnop = 3;'),
      errors: [{ messageId: 'alignEquals' }, { messageId: 'alignEquals' }],
    },
    {
      name: 'a multi-line statement with = on its first line takes part',
      code: code('const a = {', '  x: 1,', '};', 'const bcd = 2;'),
      output: code('const a   = {', '  x: 1,', '};', 'const bcd = 2;'),
      errors: [{ messageId: 'alignEquals' }],
    },
    {
      name: 'object keys align',
      code: code('const o = {', '  a: 1,', '  bcd: 2,', '};'),
      output: code('const o = {', '  a:   1,', '  bcd: 2,', '};'),
      errors: [{ messageId: 'alignValue' }],
    },
    {
      name: 'a comment line between object keys makes two groups',
      code: code('const o = {', '  a: 1,', '  bcd: 2,', '  // note', '  efghij: 3,', '};'),
      output: code('const o = {', '  a:   1,', '  bcd: 2,', '  // note', '  efghij: 3,', '};'),
      errors: [{ messageId: 'alignValue' }],
    },
    {
      name: 'a blank line between object keys makes two groups',
      code: code('const o = {', '  a: 1,', '  bcd: 2,', '', '  efghij: 3,', '  k: 4,', '};'),
      output: code('const o = {', '  a:   1,', '  bcd: 2,', '', '  efghij: 3,', '  k:      4,', '};'),
      errors: [{ messageId: 'alignValue' }, { messageId: 'alignValue' }],
    },
    {
      name: 'interface members with readonly and optional align on the colon',
      code: code('interface I {', '  readonly a: string;', '  b?: number;', '  cdef: boolean;', '}'),
      output: code('interface I {', '  readonly a: string;', '  b?:         number;', '  cdef:       boolean;', '}'),
      errors: [{ messageId: 'alignValue' }, { messageId: 'alignValue' }],
    },
    {
      name: 'type literal members align',
      code: code('type T = {', '  a: string;', '  bcd: number;', '};'),
      output: code('type T = {', '  a:   string;', '  bcd: number;', '};'),
      errors: [{ messageId: 'alignValue' }],
    },
    {
      name: 'a method and a spread end a group',
      code: code('const o = {', '  a: 1,', '  bcd: 2,', '  m() {},', '  efghij: 3,', '  k: 4,', '  ...rest,', '  lmnopq: 5,', '};'),
      output: code('const o = {', '  a:   1,', '  bcd: 2,', '  m() {},', '  efghij: 3,', '  k:      4,', '  ...rest,', '  lmnopq: 5,', '};'),
      errors: [{ messageId: 'alignValue' }, { messageId: 'alignValue' }],
    },
    {
      name: 'a multi-line value ends its member on a later line and the next member joins the group',
      code: code('const o = {', '  a: {', '    x: 1,', '  },', '  bcd: 2,', '};'),
      output: code('const o = {', '  a:   {', '    x: 1,', '  },', '  bcd: 2,', '};'),
      errors: [{ messageId: 'alignValue' }],
    },
  ],
});
