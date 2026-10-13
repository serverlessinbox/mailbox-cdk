import type { JsonObject } from '../json-value';
import type { NonDeterministicProperty } from '../template-diff';
import { TemplateDiffer } from '../template-differ';

/**
 * Pins what the refactor gate reports: every added, removed and changed entry with the exact paths
 * that changed, and a known non-deterministic property reported apart. Loosening the path or entry
 * comparison lets a template change pass the gate unnoticed; letting a non-deterministic rule
 * swallow a real change hides it.
 */
describe('TemplateDiffer', () => {
  const nonceRule: NonDeterministicProperty = {
    resourceType: 'Custom::ContentInvalidation',
    propertyPath: 'Properties.deploymentNonce',
    reason: 'unstable',
  };
  const differ = new TemplateDiffer([nonceRule]);

  function resources(entries: JsonObject): JsonObject {
    return { Resources: entries };
  }

  it('reports identical templates, ignoring the order of object keys', () => {
    const before = resources({ Queue: { Type: 'AWS::SQS::Queue', Properties: { A: 1, B: 2 } } });
    const after = resources({ Queue: { Properties: { B: 2, A: 1 }, Type: 'AWS::SQS::Queue' } });

    expect(differ.diff(before, after)).toEqual({ added: [], removed: [], changed: [], knownNonDeterministic: [], identical: true });
  });

  it('reports added and removed entries by section and logical ID', () => {
    const before: JsonObject = { ...resources({ Old: { Type: 'AWS::SQS::Queue' } }), Parameters: { Gone: { Type: 'String' } } };
    const after: JsonObject = { ...resources({ New: { Type: 'AWS::SQS::Queue' } }), Parameters: {} };

    const diff = differ.diff(before, after);

    expect(diff.added).toEqual(['Resources/New']);
    expect(diff.removed).toEqual(['Parameters/Gone', 'Resources/Old']);
    expect(diff.identical).toBe(false);
  });

  it('reports the property paths of an entry that changed, through objects and arrays', () => {
    const before = resources({
      Fn: {
        Type: 'AWS::Lambda::Function',
        Properties: { Environment: { Variables: { KEPT: 'a', CHANGED: 'old', REMOVED: 'x' } }, Tags: [{ Key: 'a' }, { Key: 'b' }] },
      },
    });
    const after = resources({
      Fn: {
        Type: 'AWS::Lambda::Function',
        Properties: { Environment: { Variables: { KEPT: 'a', CHANGED: 'new', ADDED: 'y' } }, Tags: [{ Key: 'a' }, { Key: 'c' }, { Key: 'd' }] },
      },
    });

    expect(differ.diff(before, after).changed).toEqual([
      {
        entryId: 'Resources/Fn',
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

  it('reports a known non-deterministic property apart and still counts the template as identical', () => {
    const before = resources({ Inv: { Type: 'Custom::ContentInvalidation', Properties: { deploymentNonce: 'one', Paths: ['/*'] } } });
    const after = resources({ Inv: { Type: 'Custom::ContentInvalidation', Properties: { deploymentNonce: 'two', Paths: ['/*'] } } });

    const diff = differ.diff(before, after);

    expect(diff.knownNonDeterministic).toEqual([{ entryId: 'Resources/Inv', propertyPaths: ['Properties.deploymentNonce'] }]);
    expect(diff.changed).toEqual([]);
    expect(diff.identical).toBe(true);
  });

  it('keeps a real change in the same entry as a known non-deterministic one in the failing list', () => {
    const before = resources({ Inv: { Type: 'Custom::ContentInvalidation', Properties: { deploymentNonce: 'one', Paths: ['/a'] } } });
    const after = resources({ Inv: { Type: 'Custom::ContentInvalidation', Properties: { deploymentNonce: 'two', Paths: ['/b'] } } });

    const diff = differ.diff(before, after);

    expect(diff.changed).toEqual([{ entryId: 'Resources/Inv', propertyPaths: ['Properties.Paths[0]'] }]);
    expect(diff.knownNonDeterministic).toEqual([{ entryId: 'Resources/Inv', propertyPaths: ['Properties.deploymentNonce'] }]);
    expect(diff.identical).toBe(false);
  });

  it('does not treat the same property of another resource type as non-deterministic', () => {
    const before = resources({ Other: { Type: 'Custom::Other', Properties: { deploymentNonce: 'one' } } });
    const after = resources({ Other: { Type: 'Custom::Other', Properties: { deploymentNonce: 'two' } } });

    const diff = differ.diff(before, after);

    expect(diff.changed).toEqual([{ entryId: 'Resources/Other', propertyPaths: ['Properties.deploymentNonce'] }]);
    expect(diff.knownNonDeterministic).toEqual([]);
  });
});
