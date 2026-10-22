/// <reference types="jest" />

/**
 * WebSocketPush tests: what the construct itself decides.
 *
 * Pins the exact IAM statement and endpoint URL it hands out through IWebSocketPushApi, which a
 * widened statement or a changed URL shape breaks without failing tsc or synth. Both are asserted
 * in a stack with an explicit env, where a region, account or partition taken from the stack would
 * render as a literal in the template instead of a Ref. Also pins the custom-domain wiring (stage
 * mapped onto the domain, the domain's logical id pin handed out), that only `$connect` is behind
 * the authorizer, the default subscription limit and the broadcaster handle.
 */

import { ArtifactZone, PinnedArtifactResolver } from '@serverlessinbox/artifact-registry-cdk';
import type { ArtifactPin, IArtifactResolver }  from '@serverlessinbox/artifact-registry-cdk';
import { Capture, Match, Template }             from 'aws-cdk-lib/assertions';
import * as acm                                 from 'aws-cdk-lib/aws-certificatemanager';
import { Table, AttributeType }                 from 'aws-cdk-lib/aws-dynamodb';
import * as iam                                 from 'aws-cdk-lib/aws-iam';
import * as lambda                              from 'aws-cdk-lib/aws-lambda';
import * as cdk                                 from 'aws-cdk-lib';
import { App, BootstraplessSynthesizer }        from 'aws-cdk-lib';

import { DataTable }                            from '../../../resources/tables/data-tables';
import { WebSocketPush }                        from '../websocket';
import type { WebSocketPushProps }              from '../websocket';

function buildWebSocketPush(stack: cdk.Stack, overrides: Partial<WebSocketPushProps> = {}): WebSocketPush {
  const packages: Record<string, ArtifactPin> = {
    'mailbox-go': { version: '1.0.0', zone: ArtifactZone.REGIONAL },
  };
  const artifactResolver: IArtifactResolver   = new PinnedArtifactResolver({
    packages,
    location:         { bucketBase: 'test-artifacts', project: 'serverlessinbox' },
    deploymentRegion: stack.region,
  });

  const configTable      = new DataTable(new Table(stack, 'config-table', {
    partitionKey: { name: 'pk', type: AttributeType.STRING },
  }));
  const itemTable        = new DataTable(new Table(stack, 'item-table', {
    partitionKey: { name: 'pk', type: AttributeType.STRING },
  }));
  const changelogTable   = new DataTable(new Table(stack, 'changelog-table', {
    partitionKey: { name: 'pk', type: AttributeType.STRING },
  }));
  const authorizerLambda = new lambda.Function(stack, 'authorizer', {
    runtime: lambda.Runtime.NODEJS_18_X,
    handler: 'index.handler',
    code:    lambda.Code.fromInline('exports.handler = async () => {};'),
  });

  return new WebSocketPush(stack, 'websocket-push', {
    configTable,
    itemTable,
    changelogTable,
    authorizerLambda,
    artifactResolver,
    ...overrides,
  });
}

function newStack(): cdk.Stack {
  return new cdk.Stack(new App(), 'TestStack', {
    env:         { account: '123456789012', region: 'us-west-2' },
    synthesizer: new BootstraplessSynthesizer(),
  });
}

function newCertificate(stack: cdk.Stack): acm.Certificate {
  return new acm.Certificate(stack, 'certificate', {
    domainName: 'ws.example.com',
    validation: acm.CertificateValidation.fromDns(),
  });
}

describe('WebSocketPush.grantManageConnections', () => {
  it('grants exactly one Allow statement for execute-api:ManageConnections scoped to <apiId>/*', () => {
    const stack = newStack();

    const sut  = buildWebSocketPush(stack);
    const role = new iam.Role(stack, 'TestRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
    });

    sut.grantManageConnections(role);

    const template = Template.fromStack(stack);
    const apiId    = Object.keys(template.findResources('AWS::ApiGatewayV2::Api'))[0];

    template.hasResourceProperties('AWS::IAM::Policy', {
      Roles:          Match.arrayWith([{ Ref: stack.getLogicalId(role.node.defaultChild as cdk.CfnResource) }]),
      PolicyDocument: {
        Statement: Match.arrayEquals([
          Match.objectEquals({
            Action:   'execute-api:ManageConnections',
            Effect:   'Allow',
            Resource: {
              'Fn::Join': ['', [
                'arn:', { Ref: 'AWS::Partition' }, ':execute-api:', { Ref: 'AWS::Region' }, ':', { Ref: 'AWS::AccountId' }, ':',
                { Ref: apiId }, '/*',
              ]],
            },
          }),
        ]),
      },
    });
  });
});

describe('WebSocketPush without a custom domain', () => {
  it('uses the stage URL and publishes no domain target', () => {
    const stack = newStack();

    const sut = buildWebSocketPush(stack);

    const template = Template.fromStack(stack);
    const apiId    = Object.keys(template.findResources('AWS::ApiGatewayV2::Api'))[0];
    expect(stack.resolve(sut.webSocketUrl)).toEqual({
      'Fn::Join': ['', ['wss://', { Ref: apiId }, '.execute-api.us-west-2.', { Ref: 'AWS::URLSuffix' }, '/prod']],
    });
    expect(sut.domainTarget).toBeUndefined();
    expect(sut.domainLogicalIdPin).toBeUndefined();
    template.resourceCountIs('AWS::ApiGatewayV2::DomainName', 0);
  });
});

describe('WebSocketPush with a custom domain', () => {
  it('serves on the domain, maps the stage onto it and publishes its regional target', () => {
    const stack = newStack();

    const sut = buildWebSocketPush(stack, { customDomain: { domainName: 'ws.example.com', certificate: newCertificate(stack) } });

    const template = Template.fromStack(stack);
    expect(sut.webSocketUrl).toBe('wss://ws.example.com');
    expect(sut.domainTarget).toBeDefined();
    template.hasResourceProperties('AWS::ApiGatewayV2::DomainName', { DomainName: 'ws.example.com' });
    template.hasResourceProperties('AWS::ApiGatewayV2::ApiMapping', { Stage: 'prod' });
  });

  it('hands out the logical id pin of its domain name', () => {
    const stack = newStack();

    const sut = buildWebSocketPush(stack, { customDomain: { domainName: 'ws.example.com', certificate: newCertificate(stack) } });

    sut.domainLogicalIdPin?.overrideLogicalId('PinnedDomainName');

    const domainIds = Object.keys(Template.fromStack(stack).findResources('AWS::ApiGatewayV2::DomainName'));
    expect(domainIds).toEqual(['PinnedDomainName']);
  });
});

describe('WebSocketPush routes', () => {
  it('puts only $connect behind the kebab-case named authorizer, reading the Sec-WebSocket-Protocol header', () => {
    const stack = newStack();

    buildWebSocketPush(stack);

    const template = Template.fromStack(stack);
    template.hasResourceProperties('AWS::ApiGatewayV2::Authorizer', {
      Name:           'websocket-authorizer',
      AuthorizerType: 'REQUEST',
      IdentitySource: ['route.request.header.Sec-WebSocket-Protocol'],
    });
    template.hasResourceProperties('AWS::ApiGatewayV2::Route', {
      RouteKey:          '$connect',
      AuthorizationType: 'CUSTOM',
    });
    template.hasResourceProperties('AWS::ApiGatewayV2::Route', { RouteKey: '$disconnect', AuthorizationType: 'NONE' });
    template.hasResourceProperties('AWS::ApiGatewayV2::Route', { RouteKey: '$default', AuthorizationType: 'NONE' });
  });
});

describe('WebSocketPush maxSubscriptions', () => {
  it('limits subscriptions to 10 by default', () => {
    const stack = newStack();

    buildWebSocketPush(stack);

    Template.fromStack(stack).hasResourceProperties('AWS::Lambda::Function', {
      Environment: { Variables: Match.objectLike({ MAX_SUBSCRIPTIONS: '10' }) },
    });
  });

  it('passes a given limit to the message handler', () => {
    const stack = newStack();

    buildWebSocketPush(stack, { maxSubscriptions: 3 });

    Template.fromStack(stack).hasResourceProperties('AWS::Lambda::Function', {
      Environment: { Variables: Match.objectLike({ MAX_SUBSCRIPTIONS: '3' }) },
    });
  });
});

describe('WebSocketPush.broadcaster', () => {
  it('names the broadcast function and grants invoke on it', () => {
    const stack = newStack();
    const sut   = buildWebSocketPush(stack);
    const role  = new iam.Role(stack, 'TestRole', { assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com') });

    sut.broadcaster.grantInvoke(role);

    const broadcastFunctionId = new Capture();
    Template.fromStack(stack).hasResourceProperties('AWS::IAM::Policy', {
      Roles:          [{ Ref: stack.getLogicalId(role.node.defaultChild as cdk.CfnResource) }],
      PolicyDocument: {
        Statement: [Match.objectLike({ Action: 'lambda:InvokeFunction', Resource: Match.arrayWith([{ 'Fn::GetAtt': [broadcastFunctionId, 'Arn'] }]) })],
      },
    });
    expect(stack.resolve(sut.broadcaster.functionName)).toEqual({ Ref: broadcastFunctionId.asString() });
  });
});

describe('WebSocketPush.managementEndpoint', () => {
  it('builds the ApiGatewayManagementApi endpoint URL for the given stage', () => {
    const stack = newStack();

    const sut      = buildWebSocketPush(stack);
    const template = Template.fromStack(stack);
    const apiId    = Object.keys(template.findResources('AWS::ApiGatewayV2::Api'))[0];

    expect(stack.resolve(sut.managementEndpoint)).toEqual({
      'Fn::Join': ['', ['https://', { Ref: apiId }, '.execute-api.', { Ref: 'AWS::Region' }, '.amazonaws.com/prod']],
    });
  });
});
