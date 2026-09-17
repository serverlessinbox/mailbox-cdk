/// <reference types="jest" />

/**
 * WebSocketPush.grantManageConnections / .managementEndpoint tests.
 *
 * WebSocketPush now owns the WebSocket API directly (merged from the former standalone
 * WebSocketPushApi construct). These pin the exact IAM statement shape and endpoint URL that
 * WebSocketMessageLambda/WebSocketBroadcastLambda depend on through IWebSocketPushApi.
 */

import * as cdk from 'aws-cdk-lib';
import { App, BootstraplessSynthesizer } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { Table, AttributeType } from 'aws-cdk-lib/aws-dynamodb';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as iam from 'aws-cdk-lib/aws-iam';
import { PinnedResolver, CdkArtifactEngine } from '@serverlessinbox/mailbox-cdk-shared';
import type { ArtifactVersionsEntry } from '@serverlessinbox/artifact-registry';
import type { ICdkArtifactEngine } from '@serverlessinbox/mailbox-cdk-shared';
import { WebSocketPush } from '../websocket';

function buildWebSocketPush(stack: cdk.Stack): WebSocketPush {
  const packages: Record<string, ArtifactVersionsEntry> = {
    'mailbox-go': { version: '1.0.0', zone: 'regional' },
  };
  const pinnedResolver = new PinnedResolver(stack, packages, 'test-artifacts', {});
  pinnedResolver.registerPackages(['mailbox-go']);
  const artifactResolver: ICdkArtifactEngine = new CdkArtifactEngine(stack, pinnedResolver);

  const configTable = new Table(stack, 'config-table', {
    partitionKey: { name: 'pk', type: AttributeType.STRING },
  });
  const itemTable = new Table(stack, 'item-table', {
    partitionKey: { name: 'pk', type: AttributeType.STRING },
  });
  const changelogTable = new Table(stack, 'changelog-table', {
    partitionKey: { name: 'pk', type: AttributeType.STRING },
  });
  const authorizerLambda = new lambda.Function(stack, 'authorizer', {
    runtime: lambda.Runtime.NODEJS_18_X,
    handler: 'index.handler',
    code: lambda.Code.fromInline('exports.handler = async () => {};'),
  });

  return new WebSocketPush(stack, 'websocket-push', {
    configTable,
    itemTable,
    changelogTable,
    authorizerLambda,
    artifactResolver,
  });
}

describe('WebSocketPush.grantManageConnections', () => {
  it('grants exactly one Allow statement for execute-api:ManageConnections scoped to <apiId>/*', () => {
    const app = new App({
      context: {
        'serverlessinbox:artifacts': {
          bucketBase: 'test-artifacts',
          packages: {
            'mailbox-go': { kind: 'release', version: '1.0.0' },
          },
        },
      },
    });
    const stack = new cdk.Stack(app, 'TestStack', {
      env: { account: '123456789012', region: 'us-west-2' },
      synthesizer: new BootstraplessSynthesizer(),
    });

    const sut = buildWebSocketPush(stack);
    const role = new iam.Role(stack, 'TestRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
    });

    sut.grantManageConnections(role);

    const template = Template.fromStack(stack);
    const apiId = Object.keys(template.findResources('AWS::ApiGatewayV2::Api'))[0];

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

describe('WebSocketPush.managementEndpoint', () => {
  it('builds the ApiGatewayManagementApi endpoint URL for the given stage', () => {
    const app = new App({
      context: {
        'serverlessinbox:artifacts': {
          bucketBase: 'test-artifacts',
          packages: {
            'mailbox-go': { kind: 'release', version: '1.0.0' },
          },
        },
      },
    });
    const stack = new cdk.Stack(app, 'TestStack', {
      env: { account: '123456789012', region: 'us-west-2' },
      synthesizer: new BootstraplessSynthesizer(),
    });

    const sut = buildWebSocketPush(stack);
    const template = Template.fromStack(stack);
    const apiId = Object.keys(template.findResources('AWS::ApiGatewayV2::Api'))[0];

    expect(stack.resolve(sut.managementEndpoint)).toEqual({
      'Fn::Join': ['', ['https://', { Ref: apiId }, '.execute-api.us-west-2.amazonaws.com/prod']],
    });
  });
});
