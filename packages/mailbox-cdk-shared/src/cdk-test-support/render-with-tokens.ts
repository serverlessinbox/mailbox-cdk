import * as t from 'typanion';

const isJoinPart = t.isOneOf([t.isString(), t.isPartial({})]);

const isJoin = t.isPartial({
  'Fn::Join': t.isTuple([t.isString(), t.isArray(isJoinPart)]),
});

const isRef = t.isPartial({
  Ref: t.isString(),
});

/**
 * The literal text of a synthesized template value, for substring checks: a plain string stays as it is,
 * an `Fn::Join` yields only its literal string parts (its separator, nested joins and intrinsic
 * functions are dropped), and any other value yields an empty string.
 */
export function renderLiteralText(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  if (isJoin(value)) {
    return value['Fn::Join'][1].filter((part): part is string => typeof part === 'string').join('');
  }
  return '';
}

/**
 * Renders a synthesized template value as a string: a plain string stays as it is, an `Fn::Join` is
 * joined with its separator, and any other intrinsic function (`Ref`, `Fn::GetAtt`, ...) becomes `<token>`.
 */
export function renderWithTokens(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  if (isJoin(value)) {
    const [separator, parts] = value['Fn::Join'];
    return parts.map(renderWithTokens).join(separator);
  }
  return '<token>';
}

/**
 * Renders a synthesized template value as a string, keeping each `Ref` as its JSON so an assertion can
 * name the reference: a plain string stays as it is, an `Fn::Join` is joined with its separator and its
 * parts rendered the same way, a `Ref` becomes its JSON (`{"Ref":"AWS::StackName"}`), and any other value
 * becomes an empty string.
 */
export function renderWithRefs(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  if (isJoin(value)) {
    const [separator, parts] = value['Fn::Join'];
    return parts.map(renderWithRefs).join(separator);
  }
  if (isRef(value)) {
    return JSON.stringify(value);
  }
  return '';
}
