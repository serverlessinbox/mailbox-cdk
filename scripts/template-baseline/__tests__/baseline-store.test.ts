import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir }                    from 'node:os';
import * as path                     from 'node:path';

import { BaselineStore }             from '../baseline-store';
import { TemplateJsonParser }        from '../template-json-parser';

/**
 * Pins the on-disk layout of a baseline (`<root>/<label>/<stack>.template.json`, formatted JSON),
 * that a read returns what a write stored, and that a label can never leave the baseline folder or
 * a missing baseline fail with an unexplained error.
 */
describe('BaselineStore', () => {
  let root: string;
  let store: BaselineStore;

  beforeEach(() => {
    root  = mkdtempSync(path.join(tmpdir(), 'baseline-store-'));
    store = new BaselineStore(root, new TemplateJsonParser());
  });

  it('writes each template as formatted JSON under the label and reads it back', async () => {
    const template = { Resources: { Queue: { Type: 'AWS::SQS::Queue' } } };

    const files = await store.write('before', [{ stackName: 'data', template }]);

    expect(files).toEqual([path.join(root, 'before', 'data.template.json')]);
    expect(readFileSync(files[0], 'utf8')).toBe(`${JSON.stringify(template, null, 2)}\n`);
    expect(await store.readStackTemplate('before', 'data')).toEqual(template);
  });

  it('rejects a label that could leave the baseline folder', async () => {
    await expect(store.write('../escape', [])).rejects.toThrow('Invalid label "../escape"');
  });

  it('names the file and the capture command when the baseline does not exist', async () => {
    await expect(store.readStackTemplate('missing', 'edge')).rejects.toThrow(
      `Cannot read baseline template ${path.join(root, 'missing', 'edge.template.json')}; capture it first with "yarn template-baseline capture"`,
    );
  });
});
