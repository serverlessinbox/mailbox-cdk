import * as cdk from 'aws-cdk-lib';
import { App, BootstraplessSynthesizer } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import * as iam from 'aws-cdk-lib/aws-iam';
import { WebSocketTable } from '../websocket-table';

const READ = ['dynamodb:GetItem', 'dynamodb:BatchGetItem', 'dynamodb:Query'];
const WRITE = ['dynamodb:PutItem', 'dynamodb:UpdateItem', 'dynamodb:DeleteItem'];

function createStack(): cdk.Stack {
  const app = new App();
  return new cdk.Stack(app, 'TestStack', {
    env: { account: '123456789012', region: 'us-west-2' },
    synthesizer: new BootstraplessSynthesizer(),
  });
}

describe('WebSocketTable', () => {
  it('tableName resolves to the table resource', () => {
    const stack = createStack();
    const sut = new WebSocketTable(stack, 'websocket-table');

    expect(stack.resolve(sut.tableName)).toEqual({ Ref: 'websockettablewebsocketv23A17BE62' });
  });

  it('grantWrite grants exactly one Allow statement with the write actions', () => {
    const stack = createStack();
    const sut = new WebSocketTable(stack, 'websocket-table');
    const role = new iam.Role(stack, 'TestRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
    });

    sut.grantWrite(role);

    const template = Template.fromStack(stack);
    const tableId = 'websockettablewebsocketv23A17BE62';

    template.hasResourceProperties('AWS::IAM::Policy', {
      Roles: Match.arrayWith([{ Ref: stack.getLogicalId(role.node.defaultChild as cdk.CfnResource) }]),
      PolicyDocument: {
        Statement: Match.arrayEquals([
          Match.objectEquals({
            Action: WRITE,
            Effect: 'Allow',
            Resource: [
              { 'Fn::GetAtt': [tableId, 'Arn'] },
              { 'Fn::Join': ['', [{ 'Fn::GetAtt': [tableId, 'Arn'] }, '/index/*']] },
            ],
          }),
        ]),
      },
    });
  });

  it('grantReadWrite grants exactly one Allow statement with the read+write actions', () => {
    const stack = createStack();
    const sut = new WebSocketTable(stack, 'websocket-table');
    const role = new iam.Role(stack, 'TestRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
    });

    sut.grantReadWrite(role);

    const template = Template.fromStack(stack);
    const tableId = 'websockettablewebsocketv23A17BE62';

    template.hasResourceProperties('AWS::IAM::Policy', {
      Roles: Match.arrayWith([{ Ref: stack.getLogicalId(role.node.defaultChild as cdk.CfnResource) }]),
      PolicyDocument: {
        Statement: Match.arrayEquals([
          Match.objectEquals({
            Action: [...READ, ...WRITE],
            Effect: 'Allow',
            Resource: [
              { 'Fn::GetAtt': [tableId, 'Arn'] },
              { 'Fn::Join': ['', [{ 'Fn::GetAtt': [tableId, 'Arn'] }, '/index/*']] },
            ],
          }),
        ]),
      },
    });
  });
});
