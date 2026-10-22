/// <reference types="jest" />

/**
 * McpApi tests: what the construct itself decides.
 *
 * Pins that the API is served on `mcp.<domainName>` with the given certificate and mapped onto
 * that domain, and that all four proxied methods go through the given authorizer. A method that
 * loses its authorizer stays green in tsc and synth, so these assertions are the only guard.
 */

import { ArtifactZone, PinnedArtifactResolver } from '@serverlessinbox/artifact-registry-cdk';
import { Match, Template }                      from 'aws-cdk-lib/assertions';
import { HttpApi }                              from 'aws-cdk-lib/aws-apigatewayv2';
import * as acm                                 from 'aws-cdk-lib/aws-certificatemanager';
import * as lambda                              from 'aws-cdk-lib/aws-lambda';
import * as cdk                                 from 'aws-cdk-lib';
import { App, BootstraplessSynthesizer }        from 'aws-cdk-lib';

import { Permission }                           from '../../auth/jmap-scopes';
import { McpApi }                               from '../mcp-api';

describe('McpApi', () => {
  let stack: cdk.Stack;
  let sut: McpApi;

  beforeEach(() => {
    stack                  = new cdk.Stack(new App(), 'TestStack', {
      env:         { account: '123456789012', region: 'us-west-2' },
      synthesizer: new BootstraplessSynthesizer(),
    });
    const certificate      = new acm.Certificate(stack, 'certificate', {
      domainName: 'mcp.example.com',
      validation: acm.CertificateValidation.fromDns(),
    });
    const jmapApiGateway   = new HttpApi(stack, 'jmap-http-api');
    const authorizerLambda = new lambda.Function(stack, 'authorizer', {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'index.handler',
      code:    lambda.Code.fromInline('exports.handler = async () => {};'),
    });

    sut = new McpApi(stack, 'mcp-api', {
      jmapApiGateway,
      authorizerLambda,
      certificate,
      domainName:       'example.com',
      scopeMap:         { 'mail.read': [Permission.MAIL_READ] },
      artifactResolver: new PinnedArtifactResolver({
        packages:         {
          'mailbox-cdk': { version: '1.0.0', zone: ArtifactZone.REGIONAL },
          'mailbox-go':  { version: '1.0.0', zone: ArtifactZone.REGIONAL },
        },
        location:         { bucketBase: 'test-artifacts', project: 'serverlessinbox' },
        deploymentRegion: stack.region,
      }),
    });
  });

  it('serves on mcp.<domainName>, maps the API onto the domain and publishes its target', () => {
    const template = Template.fromStack(stack);

    expect(sut.domainTarget).toBeDefined();
    template.hasResourceProperties('AWS::ApiGatewayV2::DomainName', { DomainName: 'mcp.example.com' });
    template.resourceCountIs('AWS::ApiGatewayV2::ApiMapping', 1);
  });

  it.each(['GET', 'POST', 'DELETE', 'PUT'])('routes %s through the authorizer', (method) => {
    Template.fromStack(stack).hasResourceProperties('AWS::ApiGatewayV2::Route', {
      RouteKey:          `${method} /{proxy+}`,
      AuthorizationType: 'CUSTOM',
      AuthorizerId:      Match.anyValue(),
    });
  });
});
