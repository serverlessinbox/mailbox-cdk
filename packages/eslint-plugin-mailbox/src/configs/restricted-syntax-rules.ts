import type { TSESLint } from '@typescript-eslint/utils';

/** One `no-restricted-syntax` entry: an AST selector and the message shown when it matches. */
interface RestrictedSyntaxEntry {
  readonly selector: string;
  readonly message:  string;
}

const anonymousTypeMessage = 'Name the object type with an interface or type alias (strong-typing, no anonymous nested types).';
const requireMessage       = 'Use an import, or await import() for a config module (code-structure, I/O is async).';
const commandBody          = 'ClassDeclaration[superClass.name=/Command$/] > ClassBody';

const anonymousTypeEntries: readonly RestrictedSyntaxEntry[] = [
  ':function > Identifier > TSTypeAnnotation > TSTypeLiteral',
  ':function > AssignmentPattern > Identifier > TSTypeAnnotation > TSTypeLiteral',
  ':function > ObjectPattern > TSTypeAnnotation > TSTypeLiteral',
  'TSTypeAnnotation.returnType TSTypeLiteral',
  'PropertyDefinition > TSTypeAnnotation TSTypeLiteral',
  'TSPropertySignature > TSTypeAnnotation TSTypeLiteral',
].map((selector) => ({ selector, message: anonymousTypeMessage }));

const requireEntries: readonly RestrictedSyntaxEntry[] = [
  { selector: 'CallExpression[callee.name="require"]', message: requireMessage },
  { selector: 'MemberExpression[object.name="require"]', message: requireMessage },
];

// A clipanion command's Option fields are assigned by the framework, so command bodies are excluded.
const publicStateEntries: readonly RestrictedSyntaxEntry[] = [
  {
    selector: `:not(${commandBody}) > PropertyDefinition[accessibility!="private"][accessibility!="protected"][readonly!=true][key.type!="PrivateIdentifier"]`,
    message:  'Public class state is read-only: declare it readonly (typescript-class-design).',
  },
  {
    selector: `:not(${commandBody}) > TSParameterProperty[accessibility="public"][readonly!=true]`,
    message:  'Public class state is read-only: declare the constructor parameter property readonly (typescript-class-design).',
  },
  {
    selector: `:not(${commandBody}) > MethodDefinition[kind="set"][accessibility!="private"][accessibility!="protected"]`,
    message:  'A class has no public setter (typescript-class-design).',
  },
];

export const restrictedSyntaxRules: TSESLint.FlatConfig.Rules = {
  'no-restricted-syntax': ['error', ...anonymousTypeEntries, ...requireEntries, ...publicStateEntries],
};
