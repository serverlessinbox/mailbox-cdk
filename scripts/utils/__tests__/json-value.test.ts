import { isJsonObject, isJsonObjectNode, isJsonValue, parseJsonObject } from '../json-value';

/**
 * Pins what counts as a JSON value and a JSON object, and that a parse failure names where the
 * text came from. Every baseline read goes through `parseJsonObject`, so a wrong answer here
 * reaches the diff gate.
 */
describe('json-value', () => {
  describe('isJsonValue', () => {
    it('accepts nested arrays and records', () => {
      expect(isJsonValue([1, [null, { A: [true] }]])).toBe(true);
    });

    it('rejects a value JSON cannot hold', () => {
      expect(isJsonValue(undefined)).toBe(false);
    });
  });

  describe('isJsonObject', () => {
    it('accepts an object with nested members', () => {
      expect(isJsonObject({ A: { B: [1] } })).toBe(true);
    });

    it('rejects an array', () => {
      expect(isJsonObject([1, 2])).toBe(false);
    });
  });

  describe('isJsonObjectNode', () => {
    it('accepts an object and rejects an array and null', () => {
      expect(isJsonObjectNode({ A: 1 })).toBe(true);
      expect(isJsonObjectNode([1])).toBe(false);
      expect(isJsonObjectNode(null)).toBe(false);
    });
  });

  describe('parseJsonObject', () => {
    it('parses a JSON object', () => {
      expect(parseJsonObject('{"Resources":{"A":{"Type":"X","List":[1,null,true]}}}', 'source')).toEqual({
        Resources: { A: { Type: 'X', List: [1, null, true] } },
      });
    });

    it('names the origin when the text is not valid JSON', () => {
      expect(() => parseJsonObject('{nope', 'the file')).toThrow('the file is not valid JSON');
    });

    it('names the origin when the JSON is not an object', () => {
      expect(() => parseJsonObject('[1,2]', 'the file')).toThrow('the file is not a JSON object');
    });
  });
});
