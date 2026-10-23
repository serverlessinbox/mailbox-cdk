import type { JsonObject }        from '../../utils/json-value';
import { TemplateDiffer }         from '../template-differ';

/**
 * Pins what the refactor gate reports: every added, removed and changed entry with the exact paths
 * that changed. Loosening the path or entry comparison lets a template change pass the gate unnoticed.
 */
describe('TemplateDiffer', () => {
  const differ = new TemplateDiffer();

  function resources(entries: JsonObject): JsonObject {
    return { Resources: entries };
  }

  it('reports identical templates, ignoring the order of object keys', () => {
    const before = resources({ Queue: { Type: 'AWS::SQS::Queue', Properties: { A: 1, B: 2 } } });
    const after  = resources({ Queue: { Properties: { B: 2, A: 1 }, Type: 'AWS::SQS::Queue' } });

    expect(differ.diff(before, after)).toEqual({ added: [], removed: [], changed: [], identical: true });
  });

  it('reports added and removed entries by section and logical ID', () => {
    const before: JsonObject = { ...resources({ Old: { Type: 'AWS::SQS::Queue' } }), Parameters: { Gone: { Type: 'String' } } };
    const after: JsonObject  = { ...resources({ New: { Type: 'AWS::SQS::Queue' } }), Parameters: {} };

    const diff = differ.diff(before, after);

    expect(diff.added).toEqual(['Resources/New']);
    expect(diff.removed).toEqual(['Parameters/Gone', 'Resources/Old']);
    expect(diff.identical).toBe(false);
  });

  it('reports the property paths of an entry that changed, through objects and arrays', () => {
    const before = resources({
      Fn: {
        Type:       'AWS::Lambda::Function',
        Properties: { Environment: { Variables: { KEPT: 'a', CHANGED: 'old', REMOVED: 'x' } }, Tags: [{ Key: 'a' }, { Key: 'b' }] },
      },
    });
    const after  = resources({
      Fn: {
        Type:       'AWS::Lambda::Function',
        Properties: { Environment: { Variables: { KEPT: 'a', CHANGED: 'new', ADDED: 'y' } }, Tags: [{ Key: 'a' }, { Key: 'c' }, { Key: 'd' }] },
      },
    });

    expect(differ.diff(before, after).changed).toEqual([
      {
        entryId:       'Resources/Fn',
        propertyPaths: [
          'Properties.Environment.Variables.ADDED',
          'Properties.Environment.Variables.CHANGED',
          'Properties.Environment.Variables.REMOVED',
          'Properties.Tags[1].Key',
          'Properties.Tags[2]',
        ],
      },
    ]);
  });

  it('reports a changed template member that is a single value as the entry itself', () => {
    const diff = differ.diff({ Description: 'before' }, { Description: 'after' });

    expect(diff.changed).toEqual([{ entryId: 'Description', propertyPaths: ['(value)'] }]);
  });
});
