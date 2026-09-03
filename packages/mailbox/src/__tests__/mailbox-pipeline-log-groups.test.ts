/// <reference types="jest" />

/**
 * Pipeline log group regression guard: synthesizes the full Mailbox construct and asserts every
 * Lambda function's LoggingConfig resolves to one of the pipeline log groups, no such group name
 * begins with `aws/`, and each carries the support-scoping tag.
 */

import * as cdk from 'aws-cdk-lib';
import { App, BootstraplessSynthesizer } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { Mailbox } from '../mailbox';
import type { IMailboxAuthProvider } from '../auth/types';
import { Permission } from '../auth/jmap-scopes';

function createMockAuthProvider(): IMailboxAuthProvider {
  return {
    issuer: 'https://example.com/issuer',
    tokenEndpoint: 'https://example.com/token',
    authorizationEndpoint: 'https://example.com/authorize',
    authMethod: 'header',
    usePkce: false,
    scopeMap: {
      'mail.read': [Permission.MAIL_READ],
      'mail.write': [Permission.MAIL_WRITE],
    },
    policies: {
      adminApi: {
        audiences: ['admin-api'],
      },
      jmapApi: {
        audiences: ['jmap-api'],
      },
    },
    provisionAdminUiClient: () => ({
      clientId: 'test-admin-ui',
      requestScopeList: [],
      groups: [],
    }),
    provisionJmapUiClient: () => ({
      clientId: 'test-jmap-ui',
      requestScopeList: [],
      groups: [],
    }),
  };
}

describe('Mailbox stack pipeline log groups', () => {
  function synth() {
    const app = new App({
      context: {
        artifacts: {
          bucketBase: 'test-artifacts',
          packages: {
            'mailbox-go': { kind: 'release', version: '1.0.0' },
            'mailbox-cdk': { kind: 'release', version: '1.0.0' },
            'mailbox-cdk-shared': { kind: 'release', version: '1.0.0' },
            'mailbox-cdk-edge': { kind: 'release', version: '1.0.0' },
            'mailbox-admin-ui': { kind: 'release', version: '1.0.0' },
            'mailbox-webmail-ui': { kind: 'release', version: '1.0.0' },
          },
        },
      },
    });
    const stack = new cdk.Stack(app, 'TestMailboxPipelineLogGroups', {
      env: { account: '123456789012', region: 'us-west-2' },
      synthesizer: new BootstraplessSynthesizer(),
    });

    new Mailbox(stack, 'mailbox', {
      authProvider: createMockAuthProvider(),
    });

    return Template.fromStack(stack);
  }

  it('every Lambda function resolves to one of the pipeline log groups', () => {
    const template = synth();
    const resources = template.toJSON().Resources as Record<string, { Type?: string; Properties?: Record<string, any> }>;

    const logGroupLogicalIds = new Set(
      Object.entries(resources)
        .filter(([, r]) => r.Type === 'AWS::Logs::LogGroup')
        .map(([id]) => id),
    );

    const functions = Object.entries(resources).filter(([, r]) => r.Type === 'AWS::Lambda::Function');
    expect(functions.length).toBeGreaterThan(5);

    for (const [, fn] of functions) {
      const ref = fn.Properties?.LoggingConfig?.LogGroup?.Ref;
      expect(typeof ref).toBe('string');
      expect(logGroupLogicalIds.has(ref)).toBe(true);
    }
  });

  it('no synthesized log group name begins with "aws/"', () => {
    const template = synth();
    const resources = template.toJSON().Resources as Record<string, { Type?: string; Properties?: Record<string, any> }>;

    for (const [, resource] of Object.entries(resources)) {
      if (resource.Type !== 'AWS::Logs::LogGroup') continue;
      const nameProp = resource.Properties?.LogGroupName;
      // Name is built via Fn::Join from literal parts; the first part is the literal prefix.
      const joinParts = nameProp?.['Fn::Join']?.[1] as unknown[] | undefined;
      const firstLiteral = Array.isArray(joinParts) ? joinParts[0] : nameProp;
      if (typeof firstLiteral === 'string') {
        expect(firstLiteral.startsWith('aws/')).toBe(false);
      }
    }
  });

  it('each pipeline log group carries the serverless-inbox:root-stack tag', () => {
    const template = synth();
    const resources = template.toJSON().Resources as Record<string, { Type?: string; Properties?: Record<string, any> }>;

    const pipelineGroups = Object.entries(resources).filter(([logicalId, r]) =>
      r.Type === 'AWS::Logs::LogGroup' && logicalId.toLowerCase().includes('loggroup'));

    expect(pipelineGroups.length).toBeGreaterThan(0);

    for (const [, resource] of pipelineGroups) {
      const tags = (resource.Properties?.Tags ?? []) as Array<{ Key: string; Value: unknown }>;
      const hasRootStackTag = tags.some((t) => t.Key === 'serverless-inbox:root-stack');
      expect(hasRootStackTag).toBe(true);
    }
  });

  it('every Lambda function has a PIPELINE env var matching its resolved log group', () => {
    const template = synth();
    const resources = template.toJSON().Resources as Record<string, { Type?: string; Properties?: Record<string, any> }>;

    const logGroupPipelineByLogicalId = new Map<string, string>();
    for (const [logicalId, resource] of Object.entries(resources)) {
      if (resource.Type !== 'AWS::Logs::LogGroup') continue;
      const nameProp = resource.Properties?.LogGroupName;
      const joinParts = nameProp?.['Fn::Join']?.[1] as unknown[] | undefined;
      // Adjacent literal segments ('/' + pipeline + '-') are merged by CDK's token resolution into
      // a single "/<pipeline>-" element, distinct from the surrounding tokens (stack name, guid).
      const segment = Array.isArray(joinParts) ? joinParts[2] : undefined;
      const match = typeof segment === 'string' ? segment.match(/^\/(.+)-$/) : null;
      if (match) {
        logGroupPipelineByLogicalId.set(logicalId, match[1]);
      }
    }

    const functions = Object.entries(resources).filter(([, r]) => r.Type === 'AWS::Lambda::Function');
    expect(functions.length).toBeGreaterThan(5);

    for (const [, fn] of functions) {
      const envVars = fn.Properties?.Environment?.Variables ?? {};
      const pipelineEnv = envVars.PIPELINE;
      expect(typeof pipelineEnv).toBe('string');

      const logGroupRef = fn.Properties?.LoggingConfig?.LogGroup?.Ref;
      const resolvedPipeline = logGroupPipelineByLogicalId.get(logGroupRef);
      expect(resolvedPipeline).toBeDefined();
      expect(pipelineEnv).toBe(resolvedPipeline);
    }
  });

  it('the CloudFront distribution origin carries x-pipeline: jmap', () => {
    const template = synth();
    const resources = template.toJSON().Resources as Record<string, { Type?: string; Properties?: Record<string, any> }>;

    const distributions = Object.values(resources).filter((r) => r.Type === 'AWS::CloudFront::Distribution');
    expect(distributions.length).toBeGreaterThan(0);

    const foundXPipeline = distributions.some((dist) => {
      const origins = dist.Properties?.DistributionConfig?.Origins ?? [];
      return origins.some((origin: any) => {
        const headers = origin.OriginCustomHeaders ?? [];
        return headers.some((h: any) => h.HeaderName === 'x-pipeline' && h.HeaderValue === 'jmap');
      });
    });

    expect(foundXPipeline).toBe(true);
  });
});
