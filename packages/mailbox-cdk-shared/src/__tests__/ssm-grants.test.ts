import { Match, Template }                   from 'aws-cdk-lib/assertions';
import * as iam                              from 'aws-cdk-lib/aws-iam';
import * as ssm                              from 'aws-cdk-lib/aws-ssm';
import * as cdk                              from 'aws-cdk-lib';
import { App, BootstraplessSynthesizer }     from 'aws-cdk-lib';

import { SsmActions, grantParameterActions } from '../ssm-grants';

describe('grantParameterActions', () => {
  it('read grants exactly one Allow statement with ssm:GetParameter on the parameter ARN', () => {
    const app   = new App();
    const stack = new cdk.Stack(app, 'TestStack', {
      env: { account: '123456789012', region: 'us-west-2' },
      synthesizer: new BootstraplessSynthesizer(),
    });

    const parameter = new ssm.StringParameter(stack, 'TestParam', { stringValue: 'v1' });
    const role      = new iam.Role(stack, 'TestRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
    });

    grantParameterActions(role, parameter, SsmActions.read);

    const template = Template.fromStack(stack);
    const paramId  = stack.getLogicalId(parameter.node.defaultChild as cdk.CfnResource);

    template.hasResourceProperties('AWS::IAM::Policy', {
      Roles: Match.arrayWith([{ Ref: stack.getLogicalId(role.node.defaultChild as cdk.CfnResource) }]),
      PolicyDocument: {
        Statement: Match.arrayEquals([
          Match.objectEquals({
            Action: 'ssm:GetParameter',
            Effect: 'Allow',
            Resource: {
              'Fn::Join': [
                '',
                [
                  'arn:',
                  { Ref: 'AWS::Partition' },
                  ':ssm:us-west-2:123456789012:parameter/',
                  { Ref: paramId },
                ],
              ],
            },
          }),
        ]),
      },
    });
  });
});
