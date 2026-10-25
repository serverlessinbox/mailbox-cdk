import { findReferencePaths, findSpecifierReferences } from '../declaration-references';

describe('findSpecifierReferences', () => {
  it('finds from, side-effect import, dynamic import and require specifiers with the offset of the specifier text', () => {
    const content = "import a from 'one';\nexport * from \"two\";\nimport 'three';\ntype T = import('four').X;\n";

    const references = findSpecifierReferences(content);

    expect(references.map(reference => reference.specifier)).toEqual(['one', 'two', 'three', 'four']);
    expect(content.slice(references[0].start, references[0].start + 3)).toBe('one');
  });

  it('leaves out specifiers inside comments and string literal types named like keywords', () => {
    const content = "/** import x from 'doc-only' */\n// import 'line-only'\nexport declare const kind: 'from' | 'import';\n";

    expect(findSpecifierReferences(content)).toEqual([]);
  });
});

describe('findReferencePaths', () => {
  it('returns the paths of reference path directives and not those of reference types', () => {
    const content = '/// <reference path="./a.d.ts" />\n/// <reference types="node" />\n// /// <reference path="./commented.d.ts" />\n';

    expect(findReferencePaths(content)).toEqual(['./a.d.ts']);
  });
});
