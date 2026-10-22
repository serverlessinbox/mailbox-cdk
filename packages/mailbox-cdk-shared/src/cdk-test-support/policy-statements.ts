import type { Template } from 'aws-cdk-lib/assertions';
import * as t            from 'typanion';

const isIntrinsicOrString = t.isOneOf([t.isString(), t.isPartial({})]);

const isConditionValue = t.isOneOf([
  t.isString(),
  t.isNumber(),
  t.isBoolean(),
  t.isArray(isIntrinsicOrString),
  t.isPartial({}),
]);

const isPolicyStatement = t.isPartial({
  Effect:    t.isOptional(t.isEnum(['Allow', 'Deny'] as const)),
  Action:    t.isOneOf([t.isString(), t.isArray(t.isString())]),
  Condition: t.isOptional(t.isRecord(t.isRecord(isConditionValue))),
});

const isPolicyDocument = t.isPartial({
  Statement: t.isArray(isPolicyStatement),
});

const isPolicyProperties = t.isPartial({
  PolicyName:     t.isOptional(t.isString()),
  PolicyDocument: isPolicyDocument,
  Roles:          t.isOptional(t.isArray(t.isOneOf([t.isString(), t.isPartial({ Ref: t.isOptional(t.isString()) })]))),
});

/** The properties of one synthesized `AWS::IAM::Policy`: its name, its document and the roles it is attached to. */
type PolicyProperties = t.InferType<typeof isPolicyProperties>;

/** One statement of a synthesized IAM policy document; `Resource` and `Condition` stay as synthesized. */
export type PolicyStatementJson = t.InferType<typeof isPolicyStatement>;

/** The statements of one synthesized policy document. A value that is not a policy document throws, naming what is wrong. */
export function statementsOfDocument(policyDocument: unknown): PolicyStatementJson[] {
  const errors: string[] = [];
  if (!isPolicyDocument(policyDocument, { errors })) {
    throw new Error(`Not an IAM policy document: ${errors.join('; ')}`);
  }
  return policyDocument.Statement;
}

/** The actions a statement grants, whether it names one action or a list. */
export function actionsOf(statement: PolicyStatementJson): string[] {
  return [statement.Action].flat();
}

/** The resources a statement applies to, whether it names one resource or a list. */
export function resourcesOf(statement: PolicyStatementJson): unknown[] {
  return [statement.Resource].flat();
}

/** Every statement of every `AWS::IAM::Policy` in the template. */
export function allPolicyStatements(template: Template): PolicyStatementJson[] {
  return policiesOf(template).flatMap((policy) => policy.PolicyDocument.Statement);
}

/** Every statement across every IAM policy of the template that includes `action`. */
export function statementsForAction(template: Template, action: string): PolicyStatementJson[] {
  return allPolicyStatements(template).filter((statement) => actionsOf(statement).includes(action));
}

/** Every statement across every IAM policy of the template whose `Resource` is exactly `resource`, compared as JSON. */
export function statementsForResource(template: Template, resource: unknown): PolicyStatementJson[] {
  const expectedResourceJson = JSON.stringify(resource);
  return allPolicyStatements(template).filter((statement) => JSON.stringify(statement.Resource) === expectedResourceJson);
}

/** Every statement of the `AWS::IAM::Policy` resources attached to the role with the given logical ID. */
export function statementsForRole(template: Template, roleLogicalId: string): PolicyStatementJson[] {
  return policiesOf(template)
    .filter((policy) => isAttachedToRole(policy, roleLogicalId))
    .flatMap((policy) => policy.PolicyDocument.Statement);
}

/** The statements of the one `AWS::IAM::Policy` with the given `PolicyName`; no such policy throws. */
export function statementsOfNamedPolicy(template: Template, policyName: string): PolicyStatementJson[] {
  const policy = policiesOf(template).find((candidate) => candidate.PolicyName === policyName);
  if (policy === undefined) {
    throw new Error(`No AWS::IAM::Policy named '${policyName}' in the template`);
  }
  return policy.PolicyDocument.Statement;
}

function policiesOf(template: Template): PolicyProperties[] {
  return Object.values(template.findResources('AWS::IAM::Policy')).map((synthesized) => {
    const properties: unknown = synthesized.Properties;
    const errors: string[]    = [];
    if (!isPolicyProperties(properties, { errors })) {
      throw new Error(`Not an IAM policy's properties: ${errors.join('; ')}`);
    }
    return properties;
  });
}

function isAttachedToRole(policy: PolicyProperties, roleLogicalId: string): boolean {
  return (policy.Roles ?? []).some((role) => typeof role !== 'string' && role.Ref === roleLogicalId);
}
