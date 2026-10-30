/**
 * Pins the `Partial` entries of the `no-restricted-syntax` rule: every `Partial<T>` as a type is flagged, except
 * `Partial<Record<K, V>>` over a closed key union, which is the sparse-lookup exception. A regression that stops
 * matching a flagged form lets an open-ended optional shape back into the codebase unnoticed.
 */

import { Linter }                from 'eslint';
import tseslint                  from 'typescript-eslint';

import { restrictedSyntaxRules } from '../restricted-syntax-rules';

const linter                  = new Linter();
const config: Linter.Config[] = [
  {
    files:           ['**/*.ts'],
    languageOptions: { parser: tseslint.parser },
    rules:           restrictedSyntaxRules,
  },
];

function restrictedSyntaxMessagesOf(code: string): string[] {
  return linter
    .verify(code, config, 'probe.ts')
    .filter((finding) => finding.ruleId === 'no-restricted-syntax')
    .map((finding) => finding.message);
}

describe('restrictedSyntaxRules Partial entries', () => {
  it.each([
    'type A = Partial<Foo>;',
    'function f(a: Partial<Foo>) {}',
    'interface P { readonly x?: Partial<Foo>; }',
    "type B = Partial<Pick<Foo, 'a'>>;",
    'type C = Partial<Record<string, number>>;',
  ])('flags %s', (code) => {
    const messages = restrictedSyntaxMessagesOf(code);

    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain('instead of Partial');
  });

  it.each([
    'type D = Partial<Record<Kind, number>>;',
    'type E = Required<Foo>;',
  ])('does not flag %s', (code) => {
    expect(restrictedSyntaxMessagesOf(code)).toEqual([]);
  });
});
