import * as t from 'typanion';

const isGetAtt = t.isPartial({
  'Fn::GetAtt': t.isTuple([t.isString(), t.isString()]),
});

/** The logical ID an `Fn::GetAtt` in a synthesized template points at; any other value has none. */
export function getAttLogicalId(value: unknown): string | undefined {
  return isGetAtt(value) ? value['Fn::GetAtt'][0] : undefined;
}
