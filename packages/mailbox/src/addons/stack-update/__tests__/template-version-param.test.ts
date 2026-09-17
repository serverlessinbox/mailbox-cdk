import * as cdk from 'aws-cdk-lib';
import { App, BootstraplessSynthesizer } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import * as iam from 'aws-cdk-lib/aws-iam';
import { TemplateVersionParam } from '../template-version-param';

function createStack(): cdk.Stack {
  const app = new App();
  return new cdk.Stack(app, 'TestStack', {
    env: { account: '123456789012', region: 'us-west-2' },
    synthesizer: new BootstraplessSynthesizer(),
  });
}

describe('TemplateVersionParam', () => {
  it('parameterName resolves to the inner parameter name', () => {
    const stack = createStack();
    const sut = new TemplateVersionParam(stack, 'template-version', { templateVersion: 'v0.0.53' });

    expect(stack.resolve(sut.parameterName)).toEqual(stack.resolve(sut.parameter.parameterName));
  });

  it('grantRead grants exactly one Allow statement with ssm:GetParameter on the parameter ARN', () => {
    const stack = createStack();
    const sut = new TemplateVersionParam(stack, 'template-version', { templateVersion: 'v0.0.53' });
    const role = new iam.Role(stack, 'TestRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
    });

    sut.grantRead(role);

    const template = Template.fromStack(stack);
    const paramId = stack.getLogicalId(sut.parameter.node.defaultChild as cdk.CfnResource);

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
