import { JsonBodyReader } from '../json-body-reader';

/*
 * Pins how a request body becomes a JsonValue. A body that is not JSON must stay an error with this message,
 * and every JSON shape must pass the check, nested values included, or a valid request is refused.
 */

describe('JsonBodyReader', () => {
  const reader = new JsonBodyReader();

  it('reads a missing, null or empty body as an empty object', () => {
    expect(reader.read(undefined)).toEqual({});
    expect(reader.read(null)).toEqual({});
    expect(reader.read('')).toEqual({});
  });

  it('reads every JSON shape, nested values included', () => {
    const body = '{"text":"a","count":1.5,"flag":false,"none":null,"list":[1,"b",[true,null],{"deep":{"x":[]}}]}';

    expect(reader.read(body)).toEqual({
      text: 'a',
      count: 1.5,
      flag: false,
      none: null,
      list: [1, 'b', [true, null], { deep: { x: [] } }],
    });
  });

  it('reads JSON that is not an object', () => {
    expect(reader.read('[1,2]')).toEqual([1, 2]);
    expect(reader.read('"text"')).toBe('text');
    expect(reader.read('0')).toBe(0);
  });

  it('throws "invalid JSON body" for a body that is not JSON', () => {
    expect(() => reader.read('{not json')).toThrow('invalid JSON body');
  });
});
