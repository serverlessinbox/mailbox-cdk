/**
 * Pins how IAM policy statements are read out of a synthesized template. Every IAM least-privilege
 * test in the CDK packages asserts through these readers, so a reader that returns too many or too few
 * statements makes those tests pass or fail for the wrong reason.
 */

import { App, BootstraplessSynthesizer, Stack } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import * as iam from 'aws-cdk-lib/aws-iam';
import {
  actionsOf,
  allPolicyStatements,
  resourcesOf,
  statementsForAction,
  statementsForResource,
  statementsForRole,
  statementsOfDocument,
  statementsOfNamedPolicy,
} from '../policy-statements';

function newTemplate(): { template: Template; stack: Stack; readerRole: iam.Role } {
  const stack = new Stack(new App(), 'TestStack', { synthesizer: new BootstraplessSynthesizer() });
  const readerRole = new iam.Role(stack, 'reader', { assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com') });
  const writerRole = new iam.Role(stack, 'writer', { assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com') });
  readerRole.attachInlinePolicy(
    new iam.Policy(stack, 'reader-policy', {
      policyName: 'reader-policy',
      statements: [new iam.PolicyStatement({ actions: ['s3:GetObject', 's3:ListBucket'], resources: ['*'] })],
    }),
  );
  writerRole.attachInlinePolicy(
    new iam.Policy(stack, 'writer-policy', {
      policyName: 'writer-policy',
      statements: [
        new iam.PolicyStatement({ actions: ['s3:PutObject'], resources: ['*'] }),
        new iam.PolicyStatement({ actions: ['s3:GetObject'], resources: ['arn:aws:s3:::writer-bucket/*'] }),
      ],
    }),
  );
  return { template: Template.fromStack(stack), stack, readerRole };
}

describe('statementsOfDocument', () => {
  it('returns the statements of a policy document', () => {
    const document = { Version: '2012-10-17', Statement: [{ Effect: 'Allow', Action: 's3:GetObject', Resource: '*' }] };

    expect(statementsOfDocument(document)).toEqual([{ Effect: 'Allow', Action: 's3:GetObject', Resource: '*' }]);
  });

  it('throws naming the missing Action when a statement grants nothing', () => {
    const document = { Statement: [{ Effect: 'Allow', Resource: '*' }] };

    expect(() => statementsOfDocument(document)).toThrow(/Not an IAM policy document: .*Action/);
  });

  it('throws when the value has no statement list', () => {
    expect(() => statementsOfDocument(undefined)).toThrow('Not an IAM policy document');
  });
});

describe('actionsOf', () => {
  it('wraps a single action in a list', () => {
    expect(actionsOf({ Action: 's3:GetObject' })).toEqual(['s3:GetObject']);
  });

  it('returns a list of actions as it is', () => {
    expect(actionsOf({ Action: ['s3:GetObject', 's3:ListBucket'] })).toEqual(['s3:GetObject', 's3:ListBucket']);
  });
});

describe('resourcesOf', () => {
  it('wraps a single resource in a list', () => {
    expect(resourcesOf({ Action: 's3:GetObject', Resource: '*' })).toEqual(['*']);
  });

  it('returns a list of resources as it is, keeping an intrinsic function as one entry', () => {
    const resources = ['arn:aws:s3:::bucket', { 'Fn::GetAtt': ['Bucket', 'Arn'] }];

    expect(resourcesOf({ Action: 's3:GetObject', Resource: resources })).toEqual(resources);
  });
});

describe('allPolicyStatements', () => {
  it('collects the statements of every policy in the template', () => {
    const { template } = newTemplate();

    expect(allPolicyStatements(template)).toHaveLength(3);
  });
});

describe('statementsForAction', () => {
  it('returns the statements of every policy that name the action, whether in a list or alone', () => {
    const { template } = newTemplate();

    const statements = statementsForAction(template, 's3:GetObject');

    expect(statements).toHaveLength(2);
    expect(statements.map((statement) => statement.Resource)).toEqual(['*', 'arn:aws:s3:::writer-bucket/*']);
  });

  it('returns nothing for an action no statement names', () => {
    const { template } = newTemplate();

    expect(statementsForAction(template, 's3:DeleteObject')).toEqual([]);
  });
});

describe('statementsOfNamedPolicy', () => {
  it('returns the statements of the policy with the given name only', () => {
    const { template } = newTemplate();

    const statements = statementsOfNamedPolicy(template, 'writer-policy');

    expect(statements.map(actionsOf)).toEqual([['s3:PutObject'], ['s3:GetObject']]);
  });

  it('throws naming the policy when the template has none with that name', () => {
    const { template } = newTemplate();

    expect(() => statementsOfNamedPolicy(template, 'missing-policy')).toThrow("No AWS::IAM::Policy named 'missing-policy'");
  });
});

describe('statementsForResource', () => {
  it('returns only the statements whose Resource equals the given value', () => {
    const { template } = newTemplate();

    const statements = statementsForResource(template, 'arn:aws:s3:::writer-bucket/*');

    expect(statements.map(actionsOf)).toEqual([['s3:GetObject']]);
  });

  it('returns every statement that shares the Resource, across policies', () => {
    const { template } = newTemplate();

    expect(statementsForResource(template, '*')).toHaveLength(2);
  });

  it('returns nothing when no statement has that Resource', () => {
    const { template } = newTemplate();

    expect(statementsForResource(template, 'arn:aws:s3:::other/*')).toEqual([]);
  });
});

describe('statementsForRole', () => {
  it('returns only the statements of the policies attached to the role', () => {
    const { template, stack, readerRole } = newTemplate();

    const statements = statementsForRole(template, stack.getLogicalId(readerRole.node.defaultChild as iam.CfnRole));

    expect(statements).toHaveLength(1);
    expect(statements[0].Action).toEqual(['s3:GetObject', 's3:ListBucket']);
  });

  it('returns nothing for a role no policy is attached to', () => {
    const { template } = newTemplate();

    expect(statementsForRole(template, 'UnknownRole')).toEqual([]);
  });
});
