import { TemplateJsonParser } from '../template-json-parser';

/** Pins that only JSON objects get through and that a failure names where the text came from. */
describe('TemplateJsonParser', () => {
  const parser = new TemplateJsonParser();

  it('parses a JSON object', () => {
    expect(parser.parse('{"Resources":{"A":{"Type":"X","List":[1,null,true]}}}', 'source')).toEqual({
      Resources: { A: { Type: 'X', List: [1, null, true] } },
    });
  });

  it('names the origin when the text is not valid JSON', () => {
    expect(() => parser.parse('{nope', 'the file')).toThrow('the file is not valid JSON');
  });

  it('names the origin when the JSON is not an object', () => {
    expect(() => parser.parse('[1,2]', 'the file')).toThrow('the file is not a JSON object');
  });
});
