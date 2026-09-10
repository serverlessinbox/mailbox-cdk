/**
 * API Authorizer Tests
 *
 * Tests that AdminApi, JMapApi, and McpApi properly wire HttpLambdaAuthorizer
 * to all their routes (except intentionally public routes, if any).
 *
 * Security requirements:
 * - Every API route MUST have an AuthorizerId referencing an AWS::ApiGatewayV2::Authorizer
 * - Routes without explicit authorizer config MUST NOT exist (authType defaults to 'NONE')
 * - An AWS::ApiGatewayV2::Authorizer resource MUST be created for each API
 */

import * as cdk from 'aws-cdk-lib';
import { App, BootstraplessSynthesizer } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { Construct } from 'constructs';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import { AdminApi } from '../api/admin-api';
import { JMapApi } from '../api/jmap-api';
import { McpApi } from '../api/mcp-api';
import { PinnedResolver, CdkArtifactEngine } from '@serverlessinbox/mailbox-cdk-shared';
import type { ICdkArtifactEngine } from '@serverlessinbox/mailbox-cdk-shared';
import type { ArtifactVersionsEntry } from '@serverlessinbox/artifact-registry';
import type { IMailboxAuthProvider } from '../auth/types';
import { Permission } from '../auth/jmap-scopes';
import {
  CloudFormationResource,
  isResourceOfType,
} from './iam-test-helpers';

/**
 * Minimal mock IMailboxAuthProvider for testing
 */
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

/**
 * Helper to find authorizer resources. Optionally filter by a pattern in the logical ID.
 * CDK generates logical IDs by concatenating path components, so 'admin-api' becomes 'adminapi'.
 */
function findAuthorizerResources(
  resources: Record<string, CloudFormationResource> | undefined,
  apiPattern?: string,
): Array<[string, CloudFormationResource]> {
  const results: Array<[string, CloudFormationResource]> = [];
  if (!resources) return results;
  for (const [logicalId, resource] of Object.entries(resources)) {
    if (!isResourceOfType(resource, 'AWS::ApiGatewayV2::Authorizer')) continue;
    if (apiPattern) {
      // Remove hyphens from pattern to match CDK's logical ID generation
      const normalizedPattern = apiPattern.replace(/-/g, '');
      if (!logicalId.toLowerCase().includes(normalizedPattern.toLowerCase())) continue;
    }
    results.push([logicalId, resource]);
  }
  return results;
}

/**
 * Helper to get Route resources. Optionally filter by API pattern.
 */
function findRouteResources(
  resources: Record<string, CloudFormationResource> | undefined,
  apiPattern?: string,
): Array<[string, CloudFormationResource]> {
  const routes: Array<[string, CloudFormationResource]> = [];
  if (!resources) return routes;
  for (const [logicalId, resource] of Object.entries(resources)) {
    if (!isResourceOfType(resource, 'AWS::ApiGatewayV2::Route')) continue;
    if (apiPattern) {
      // Remove hyphens from pattern to match CDK's logical ID generation
      const normalizedPattern = apiPattern.replace(/-/g, '');
      if (!logicalId.toLowerCase().includes(normalizedPattern.toLowerCase())) continue;
    }
    routes.push([logicalId, resource]);
  }
  return routes;
}

describe('API Authorizer Wiring', () => {
  let app: App;
  let stack: cdk.Stack;
  let artifactResolver: ICdkArtifactEngine;
  let configTable: dynamodb.ITable;
  let itemTable: dynamodb.ITable;
  let changelogTable: dynamodb.ITable;
  let auditLogTable: dynamodb.ITable;
  let mailFeedbackTable: dynamodb.ITable;
  let authKeyStoreTable: dynamodb.ITable;
  let blobStore: s3.IBucket;
  let emailSubmissionQueue: sqs.IQueue;
  let auditEventsQueue: sqs.IQueue;
  let identityProvisionerFunction: lambda.IFunction;
  let mockAuthProvider: IMailboxAuthProvider;
  let certificate: acm.ICertificate;

  beforeEach(() => {
    app = new App({
      context: {
        'serverlessinbox:artifacts': {
          bucketBase: 'test-artifacts',
          packages: {
            'mailbox-cdk': { kind: 'release', version: '1.0.0' },
            'mailbox-go': { kind: 'release', version: '1.0.0' },
          },
        },
      },
    });
    stack = new cdk.Stack(app, 'TestStack', {
      env: { account: '123456789012', region: 'us-west-2' },
      synthesizer: new BootstraplessSynthesizer(),
    });

    // Create artifact resolver
    const packages: Record<string, ArtifactVersionsEntry> = {
      'mailbox-cdk': { version: '1.0.0', zone: 'regional' },
      'mailbox-go': { version: '1.0.0', zone: 'regional' },
    };
    const pinnedResolver = new PinnedResolver(stack, packages, 'test-artifacts', {});
    pinnedResolver.registerPackages(['mailbox-cdk', 'mailbox-go']);
    const engine = new CdkArtifactEngine(stack, pinnedResolver);
    artifactResolver = engine;

    // Create minimal required resources
    configTable = new dynamodb.Table(stack, 'config-table', {
      partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
    });

    itemTable = new dynamodb.Table(stack, 'item-table', {
      partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
    });

    changelogTable = new dynamodb.Table(stack, 'changelog-table', {
      partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
    });

    auditLogTable = new dynamodb.Table(stack, 'audit-log-table', {
      partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
    });

    mailFeedbackTable = new dynamodb.Table(stack, 'mail-feedback-table', {
      partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
    });

    authKeyStoreTable = new dynamodb.Table(stack, 'auth-key-store-table', {
      partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
    });

    blobStore = new s3.Bucket(stack, 'blob-store');
    emailSubmissionQueue = new sqs.Queue(stack, 'email-submission-queue');
    auditEventsQueue = new sqs.Queue(stack, 'audit-events-queue');

    // Identity provisioner function - use a minimal Node.js function for testing
    identityProvisionerFunction = new lambda.Function(stack, 'identity-provisioner', {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'index.handler',
      code: lambda.Code.fromInline('exports.handler = async () => {};'),
    });

    mockAuthProvider = createMockAuthProvider();

    // Create a self-signed certificate for domain tests
    certificate = new acm.Certificate(stack, 'test-cert', {
      domainName: 'example.com',
      validation: acm.CertificateValidation.fromDns(),
    });
  });

  describe('AdminApi', () => {
    it('should attach HttpLambdaAuthorizer to the HTTP API', () => {
      const apiGroup = new Construct(stack, 'api-group');
      new AdminApi(apiGroup, 'admin-api', {
        configTable,
        itemTable,
        auditLogTable,
        changelogTable,
        mailFeedbackTable,
        authKeyStoreTable,
        blobStore,
        emailSubmissionQueue,
        auditEventsQueue,
        artifactResolver,
        authProvider: mockAuthProvider,
        identityProvisionerFunction,
        sesRuleSetName: 'test-rule-set',
        sesConfigSetName: 'test-config-set',
        systemSenderAddress: 'noreply@example.com',
        vendorAccountIds: ['123456789012'],
        stackIdentityTagKey: 'serverless-inbox:root-stack',
      });

      const template = Template.fromStack(stack);
      const resources = template.toJSON().Resources as Record<string, CloudFormationResource> | undefined;
      if (!resources) throw new Error('No resources in template');

      // Verify an Authorizer resource exists
      const authorizers = findAuthorizerResources(resources, 'admin-api');
      expect(authorizers.length).toBeGreaterThan(0);
      if (authorizers.length === 0) throw new Error('No authorizers found for AdminApi');
      const [, authorizerResource] = authorizers[0];
      expect(isResourceOfType(authorizerResource, 'AWS::ApiGatewayV2::Authorizer')).toBe(true);

      // Verify all routes have an AuthorizerId
      const routes = findRouteResources(resources, 'admin-api');
      expect(routes.length).toBeGreaterThan(0);

      for (const [, route] of routes) {
        const props = route.Properties as Record<string, unknown> | undefined;
        const authorizerId = props?.AuthorizerId;
        expect(authorizerId).toBeDefined();
        expect(typeof authorizerId === 'string' || typeof authorizerId === 'object').toBe(true);
      }
    });

    it('should catch regression if route authorizer is removed', () => {
      // This test is a regression check - it will be temporarily broken
      // to verify the assertion actually fails when authorizer is misconfigured
      const apiGroup = new Construct(stack, 'api-group');
      new AdminApi(apiGroup, 'admin-api', {
        configTable,
        itemTable,
        auditLogTable,
        changelogTable,
        mailFeedbackTable,
        authKeyStoreTable,
        blobStore,
        emailSubmissionQueue,
        auditEventsQueue,
        artifactResolver,
        authProvider: mockAuthProvider,
        identityProvisionerFunction,
        sesRuleSetName: 'test-rule-set',
        sesConfigSetName: 'test-config-set',
        systemSenderAddress: 'noreply@example.com',
        vendorAccountIds: ['123456789012'],
        stackIdentityTagKey: 'serverless-inbox:root-stack',
      });

      const template = Template.fromStack(stack);
      const resources = template.toJSON().Resources as Record<string, CloudFormationResource> | undefined;
      if (!resources) throw new Error('No resources in template');

      // Verify all routes have an AuthorizerId (this would fail if authorizer prop is removed)
      const routes = findRouteResources(resources, 'admin-api');
      for (const [, route] of routes) {
        const props = route.Properties as Record<string, unknown> | undefined;
        expect(props?.AuthorizerId).toBeDefined();
      }
    });

    it('should set SYSTEM_SENDER_ADDRESS environment variable', () => {
      const apiGroup = new Construct(stack, 'api-group-env');
      new AdminApi(apiGroup, 'admin-api', {
        configTable,
        itemTable,
        auditLogTable,
        changelogTable,
        mailFeedbackTable,
        authKeyStoreTable,
        blobStore,
        emailSubmissionQueue,
        auditEventsQueue,
        artifactResolver,
        authProvider: mockAuthProvider,
        identityProvisionerFunction,
        sesRuleSetName: 'test-rule-set',
        sesConfigSetName: 'test-config-set',
        systemSenderAddress: 'noreply@example.com',
        vendorAccountIds: ['123456789012'],
        stackIdentityTagKey: 'serverless-inbox:root-stack',
      });

      const template = Template.fromStack(stack);
      template.hasResourceProperties('AWS::Lambda::Function', {
        Environment: {
          Variables: {
            'SYSTEM_SENDER_ADDRESS': 'noreply@example.com',
          },
        },
      });
    });
  });

  describe('JMapApi', () => {
    it('should attach HttpLambdaAuthorizer to the HTTP API', () => {
      const apiGroup = new Construct(stack, 'api-group');
      new JMapApi(apiGroup, 'jmap-api', {
        configTable,
        itemTable,
        changelogTable,
        authKeyStoreTable,
        blobStore,
        emailSubmissionQueue,
        auditEventsQueue,
        oauthClientId: 'JMAP_UI',
        cdnHost: 'cdn.example.com',
        artifactResolver,
        authProvider: mockAuthProvider,
        identityProvisionerFunction,
        sesConfigSetName: 'test-config-set',
        vendorAccountIds: ['123456789012'],
      });

      const template = Template.fromStack(stack);
      const resources = template.toJSON().Resources as Record<string, CloudFormationResource> | undefined;
      if (!resources) throw new Error('No resources in template');

      // Verify an Authorizer resource exists
      const authorizers = findAuthorizerResources(resources, 'jmap-api');
      expect(authorizers.length).toBeGreaterThan(0);
      const [, authorizerResource] = authorizers[0];
      expect(isResourceOfType(authorizerResource, 'AWS::ApiGatewayV2::Authorizer')).toBe(true);

      // Verify all routes have an AuthorizerId
      const routes = findRouteResources(resources, 'jmap-api');
      expect(routes.length).toBeGreaterThan(0);

      for (const [, route] of routes) {
        const props = route.Properties as Record<string, unknown> | undefined;
        const authorizerId = props?.AuthorizerId;
        expect(authorizerId).toBeDefined();
        expect(typeof authorizerId === 'string' || typeof authorizerId === 'object').toBe(true);
      }
    });

    it('should verify all three expected routes exist with authorizer', () => {
      const apiGroup = new Construct(stack, 'api-group');
      new JMapApi(apiGroup, 'jmap-api', {
        configTable,
        itemTable,
        changelogTable,
        authKeyStoreTable,
        blobStore,
        emailSubmissionQueue,
        auditEventsQueue,
        oauthClientId: 'JMAP_UI',
        cdnHost: 'cdn.example.com',
        artifactResolver,
        authProvider: mockAuthProvider,
        identityProvisionerFunction,
        sesConfigSetName: 'test-config-set',
        vendorAccountIds: ['123456789012'],
      });

      const template = Template.fromStack(stack);
      const resources = template.toJSON().Resources as Record<string, CloudFormationResource> | undefined;
      if (!resources) throw new Error('No resources in template');

      // Find routes for JMapApi
      const routes = findRouteResources(resources, 'jmap-api');

      // We expect at least the main three routes:
      // - /.well-known/jmap (GET)
      // - / (POST)
      // - /upload/{accountId} (POST)
      expect(routes.length).toBeGreaterThanOrEqual(3);

      // All must have AuthorizerId
      for (const [, route] of routes) {
        const props = route.Properties as Record<string, unknown> | undefined;
        expect(props?.AuthorizerId).toBeDefined();
      }
    });
  });

  describe('McpApi', () => {
    it('should attach HttpLambdaAuthorizer to the HTTP API', () => {
      const apiGroup = new Construct(stack, 'api-group');

      // First create a JMAP API to get its authorizer lambda
      const jmapApiGroup = new Construct(stack, 'jmap-api-group');
      const jmapApi = new JMapApi(jmapApiGroup, 'jmap-api', {
        configTable,
        itemTable,
        changelogTable,
        authKeyStoreTable,
        blobStore,
        emailSubmissionQueue,
        auditEventsQueue,
        oauthClientId: 'JMAP_UI',
        cdnHost: 'cdn.example.com',
        artifactResolver,
        authProvider: mockAuthProvider,
        identityProvisionerFunction,
        sesConfigSetName: 'test-config-set',
        vendorAccountIds: ['123456789012'],
      });

      // Create McpApi with the JMAP authorizer
      new McpApi(apiGroup, 'mcp-api', {
        configTable,
        jmapApiGateway: jmapApi.httpApi,
        authorizerLambda: jmapApi.authorizerLambda,
        certificate,
        domainName: 'example.com',
        scopeMap: {
          'mail.read': ['read'],
          'mail.write': ['write'],
        },
        artifactResolver,
      });

      const template = Template.fromStack(stack);
      const resources = template.toJSON().Resources as Record<string, CloudFormationResource> | undefined;
      if (!resources) throw new Error('No resources in template');

      // Verify an Authorizer resource exists for MCP API
      const authorizers = findAuthorizerResources(resources, 'mcp-api');
      expect(authorizers.length).toBeGreaterThan(0);
      const [, authorizerResource] = authorizers[0];
      expect(isResourceOfType(authorizerResource, 'AWS::ApiGatewayV2::Authorizer')).toBe(true);

      // Verify all routes have an AuthorizerId
      const routes = findRouteResources(resources, 'mcp-api');
      expect(routes.length).toBeGreaterThan(0);

      for (const [, route] of routes) {
        const props = route.Properties as Record<string, unknown> | undefined;
        const authorizerId = props?.AuthorizerId;
        expect(authorizerId).toBeDefined();
        expect(typeof authorizerId === 'string' || typeof authorizerId === 'object').toBe(true);
      }
    });

    it('should verify proxy route exists with authorizer', () => {
      const apiGroup = new Construct(stack, 'api-group');

      const jmapApiGroup = new Construct(stack, 'jmap-api-group');
      const jmapApi = new JMapApi(jmapApiGroup, 'jmap-api', {
        configTable,
        itemTable,
        changelogTable,
        authKeyStoreTable,
        blobStore,
        emailSubmissionQueue,
        auditEventsQueue,
        oauthClientId: 'JMAP_UI',
        cdnHost: 'cdn.example.com',
        artifactResolver,
        authProvider: mockAuthProvider,
        identityProvisionerFunction,
        sesConfigSetName: 'test-config-set',
        vendorAccountIds: ['123456789012'],
      });

      new McpApi(apiGroup, 'mcp-api', {
        configTable,
        jmapApiGateway: jmapApi.httpApi,
        authorizerLambda: jmapApi.authorizerLambda,
        certificate,
        domainName: 'example.com',
        scopeMap: {
          'mail.read': ['read'],
          'mail.write': ['write'],
        },
        artifactResolver,
      });

      const template = Template.fromStack(stack);
      const resources = template.toJSON().Resources as Record<string, CloudFormationResource> | undefined;
      if (!resources) throw new Error('No resources in template');

      // MCP API has one proxy route: /{proxy+}
      const routes = findRouteResources(resources, 'mcp-api');
      expect(routes.length).toBeGreaterThan(0);

      // All must have AuthorizerId
      for (const [, route] of routes) {
        const props = route.Properties as Record<string, unknown> | undefined;
        expect(props?.AuthorizerId).toBeDefined();
      }
    });
  });
});
