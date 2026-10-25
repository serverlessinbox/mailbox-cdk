/**
 * Finds module specifiers in emitted declarations: `from 'x'`, `import 'x'`, `import('x')` and
 * `require('x')`. The lookbehind keeps a string literal type such as `'from'` from matching.
 */
const specifierPattern = /(?<![\w'"$.])(?:from\s*|import\s*\(\s*|import\s*|require\s*\(\s*)(['"])([^'"\s]+)\1/g;

/** String literals are matched too, so a `/*` inside one does not start a comment. */
const commentPattern = /'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|\/\*[\s\S]*?\*\/|\/\/[^\n]*/g;

/** A triple-slash directive naming a file: `/// <reference path="./x.d.ts" />`. */
const referencePathPattern = /^[ \t]*\/\/\/\s*<reference\s+path\s*=\s*(['"])([^'"]+)\1/gm;

/** A module specifier found in a declaration file, with the offset of the specifier text itself. */
export interface SpecifierReference {
  readonly specifier: string;
  readonly start:     number;
}

/** Every module specifier a declaration file's code names; specifiers inside comments are left out. */
export function findSpecifierReferences(content: string): SpecifierReference[] {
  const comments = [...content.matchAll(commentPattern)]
    .filter(match => match[0].startsWith('/'))
    .map(match => ({ start: match.index, end: match.index + match[0].length }));

  const references: SpecifierReference[] = [];
  for (const match of content.matchAll(specifierPattern)) {
    const insideComment = comments.some(comment => match.index >= comment.start && match.index < comment.end);
    if (!insideComment) {
      references.push({ specifier: match[2], start: match.index + match[0].length - match[2].length - 1 });
    }
  }
  return references;
}

/** The file paths named by `/// <reference path="..." />` directives, as written. */
export function findReferencePaths(content: string): string[] {
  return [...content.matchAll(referencePathPattern)].map(match => match[2]);
}
