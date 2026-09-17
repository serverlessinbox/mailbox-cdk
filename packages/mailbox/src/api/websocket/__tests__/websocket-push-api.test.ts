import * as cdk from 'aws-cdk-lib';
import { App, BootstraplessSynthesizer } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import * as iam from 'aws-cdk-lib/aws-iam';
import { WebSocketPushApi } from '../websocket-push-api';

describe('WebSocketPushApi.grantManageConnections', () => {
  it('grants exactly one Allow statement for execute-api:ManageConnections scoped to <apiId>/*', () => {
    const app = new App();
    const stack = new cdk.Stack(app, 'TestStack', {
      env: { account: '123456789012', region: 'us-west-2' },
      synthesizer: new BootstraplessSynthesizer(),
    });

    const sut = new WebSocketPushApi(stack, 'websocket-push-api');
    const role = new iam.Role(stack, 'TestRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
    });

    sut.grantManageConnections(role);

    const template = Template.fromStack(stack);
    const apiId = stack.getLogicalId(sut.api.node.defaultChild as cdk.CfnResource);

    template.hasResourceProperties('AWS::IAM::Policy', {
      Roles: Match.arrayWith([{ Ref: stack.getLogicalId(role.node.defaultChild as cdk.CfnResource) }]),
      PolicyDocument: {
        Statement: Match.arrayEquals([
          Match.objectEquals({
            Action: 'execute-api:ManageConnections',
            Effect: 'Allow',
            Resource: {
              'Fn::Join': ['', ['arn:aws:execute-api:us-west-2:123456789012:', { Ref: apiId }, '/*']],
            },
          }),
        ]),
      },
    });
  });
});
