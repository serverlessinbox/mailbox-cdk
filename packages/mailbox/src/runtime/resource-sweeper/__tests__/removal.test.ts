/**
 * Coverage for the detector payload check in `removal.ts`. A detector sweep carries any of its three parts
 * (rule, function, role), each whole and at least one present: a half part names a resource the sweeper
 * cannot address, and no part would sweep nothing yet report success.
 */

import { isWorkerInput } from '../removal';

const ROOT_STACK = { rootStackName: 'test-stack', rootStackId: 'guid-1' };

const RULE_PART     = { ruleArn: 'arn:aws:events:us-west-2:123456789012:rule/r', ruleTargetId: 'Target0' };
const FUNCTION_PART = { detectorFnArn: 'arn:aws:lambda:us-west-2:123456789012:function:f' };
const ROLE_PART     = { detectorRoleArn: 'arn:aws:iam::123456789012:role/ro', detectorRolePolicyName: 'p' };

function detectorPayload(target: Record<string, string>): Record<string, unknown> {
  return { removalType: 'detector', target, ...ROOT_STACK };
}

function errorsOf(payload: unknown): string[] {
  const errors: string[] = [];
  isWorkerInput(payload, { errors });
  return errors;
}

describe('isWorkerInput for a detector payload', () => {
  it.each([
    ['the rule alone', RULE_PART],
    ['the function alone', FUNCTION_PART],
    ['the role alone', ROLE_PART],
    ['all three parts', { ...RULE_PART, ...FUNCTION_PART, ...ROLE_PART }],
  ])('accepts %s', (_name, target) => {
    expect(isWorkerInput(detectorPayload(target))).toBe(true);
  });

  it('rejects a part with only some of its fields, naming the rule', () => {
    const payload = detectorPayload({ ruleArn: RULE_PART.ruleArn });

    expect(isWorkerInput(payload)).toBe(false);
    expect(errorsOf(payload).join('; ')).toContain('each detector part (rule, function, role) must carry all of its fields or none');
  });

  it('rejects a payload with no part, naming the rule', () => {
    const payload = detectorPayload({});

    expect(isWorkerInput(payload)).toBe(false);
    expect(errorsOf(payload).join('; ')).toContain('at least one detector part (rule, function, role) must be present');
  });

  it('rejects a rule whose target id is empty, which would remove no target', () => {
    expect(isWorkerInput(detectorPayload({ ...RULE_PART, ruleTargetId: '' }))).toBe(false);
  });
});
