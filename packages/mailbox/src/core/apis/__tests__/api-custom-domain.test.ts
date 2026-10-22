/// <reference types="jest" />

/**
 * ApiCustomDomain tests: the custom domain every API is served on.
 *
 * Pins the regional endpoint and TLS 1.2 policy, that the domain depends on its certificate so it
 * is deleted first, and that the logical id can be pinned. A domain that outlives the dependency
 * on its certificate fails the deploy, not the synth, so these assertions are the only guard.
 */

import { Match, Template }                         from 'aws-cdk-lib/assertions';
import * as acm                                    from 'aws-cdk-lib/aws-certificatemanager';
import * as cdk                                    from 'aws-cdk-lib';
import { App, BootstraplessSynthesizer }           from 'aws-cdk-lib';

import { ApiCustomDomain }                         from '../api-custom-domain';

describe('ApiCustomDomain', () => {
  let stack: cdk.Stack;
  let certificate: acm.Certificate;

  beforeEach(() => {
    stack       = new cdk.Stack(new App(), 'TestStack', {
      env:         { account: '123456789012', region: 'us-west-2' },
      synthesizer: new BootstraplessSynthesizer(),
    });
    certificate = new acm.Certificate(stack, 'certificate', {
      domainName: 'api.example.com',
      validation: acm.CertificateValidation.fromDns(),
    });
  });

  it('is a regional TLS 1.2 domain with the given name and certificate', () => {
    new ApiCustomDomain(stack, 'domain', { domainName: 'api.example.com', certificate });

    const template        = Template.fromStack(stack);
    const [certificateId] = Object.keys(template.findResources('AWS::CertificateManager::Certificate'));

    template.hasResourceProperties('AWS::ApiGatewayV2::DomainName', {
      DomainName:               'api.example.com',
      DomainNameConfigurations: [{
        EndpointType:   'REGIONAL',
        SecurityPolicy: 'TLS_1_2',
        CertificateArn: { Ref: certificateId },
      }],
    });
  });

  it('depends on the certificate so the domain is deleted first', () => {
    new ApiCustomDomain(stack, 'domain', { domainName: 'api.example.com', certificate });

    const template        = Template.fromStack(stack);
    const [certificateId] = Object.keys(template.findResources('AWS::CertificateManager::Certificate'));

    template.hasResource('AWS::ApiGatewayV2::DomainName', {
      DependsOn: Match.arrayWith([certificateId]),
    });
  });

  it('hands out a pin that fixes the logical id of its domain name resource', () => {
    const sut = new ApiCustomDomain(stack, 'domain', { domainName: 'api.example.com', certificate });

    sut.logicalIdPin.overrideLogicalId('PinnedDomainName');

    const template = Template.fromStack(stack);
    expect(Object.keys(template.findResources('AWS::ApiGatewayV2::DomainName'))).toEqual(['PinnedDomainName']);
  });
});
