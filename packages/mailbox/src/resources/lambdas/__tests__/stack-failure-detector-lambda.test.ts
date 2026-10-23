/// <reference types="jest" />

/**
 * StackFailureDetectorLambda: the wrapper's pinned function name, the supplied role, the log group environment variable,
 * timeout and memory, the stack-failed rule that targets the function, and the policies attached to the supplied role.
 */

import { Template }                             from 'aws-cdk-lib/assertions';
import * as iam                                 from 'aws-cdk-lib/aws-iam';
import type * as cdk                            from 'aws-cdk-lib';
import * as t                                   from 'typanion';

import { resourcesOfType }                      from '../../../__tests__/template-resources';
import { defaultCfnResource }                   from '../../../utils/cfn-resource';
import { StackFailureDetectorLambda }           from '../stack-failure-detector-lambda';

import { arrangeWrapperStack }                  from './lambda-wrapper-helpers';

const isPolicyProperties = t.isPartial({
  Roles: t.isOptional(t.isArray(t.isPartial({ Ref: t.isString() }))),
});

const isRoleProperties = t.isPartial({
  Policies: t.isOptional(t.isArray(t.isPartial({ PolicyName: t.isString() }))),
});

function createDetector(): { stack: cdk.Stack; role: iam.Role; detector: StackFailureDetectorLambda } {
  const { stack, artifactResolver } = arrangeWrapperStack();
  const role                        = new iam.Role(stack, 'DetectorRole', {
    assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
  });

  const detector = new StackFailureDetectorLambda(stack, 'detector', {
    artifactResolver,
    role,
    functionName:      'pinned-detector-name',
    infraLogGroupName: '/test/infra-log-group',
  });

  return { stack, role, detector };
}

describe('StackFailureDetectorLambda', () => {
  it('runs under the given role with the given name, 2 minute timeout and 256 MB', () => {
    const { stack, role }  = createDetector();
    const roleArn: unknown = stack.resolve(role.roleArn);

    Template.fromStack(stack).hasResourceProperties('AWS::Lambda::Function', {
      FunctionName: 'pinned-detector-name',
      Role:         roleArn,
      Timeout:      120,
      MemorySize:   256,
    });
  });

  it('passes the infra log group name in INFRA_LOG_GROUP_NAME', () => {
    const { stack } = createDetector();

    Template.fromStack(stack).hasResourceProperties('AWS::Lambda::Function', {
      Environment: { Variables: { INFRA_LOG_GROUP_NAME: '/test/infra-log-group' } },
    });
  });

  it('creates the stack-failed rule under itself, targeting itself, and exposes it', () => {
    const { stack, detector }  = createDetector();
    const template             = Template.fromStack(stack);
    const [ruleId]             = Object.keys(template.findResources('AWS::Events::Rule'));
    const functionArn: unknown = stack.resolve(detector.functionArn);
    const ruleArn: unknown     = stack.resolve(detector.stackFailedEvent.ruleArn);

    expect(Object.keys(template.findResources('AWS::Events::Rule'))).toHaveLength(1);
    template.hasResourceProperties('AWS::Events::Rule', {
      Targets: [{ Id: detector.stackFailedEvent.ruleTargetId, Arn: functionArn }],
    });
    expect(ruleArn).toEqual({ 'Fn::GetAtt': [ruleId, 'Arn'] });
  });

  it('attaches exactly the policies the class intends to the given role, which is none, attached or inline', () => {
    const { stack, role } = createDetector();
    const template        = Template.fromStack(stack);
    const roleLogicalId   = stack.getLogicalId(defaultCfnResource(role));

    const attachedPolicies = resourcesOfType(template, 'AWS::IAM::Policy', isPolicyProperties)
      .filter(({ properties }) => (properties.Roles ?? []).some((roleRef) => roleRef.Ref === roleLogicalId));
    const inlinePolicies   = resourcesOfType(template, 'AWS::IAM::Role', isRoleProperties)
      .filter(({ logicalId }) => logicalId === roleLogicalId)
      .flatMap(({ properties }) => properties.Policies ?? []);

    expect(attachedPolicies.map((policy) => policy.logicalId)).toEqual([]);
    expect(inlinePolicies).toEqual([]);
  });
});
