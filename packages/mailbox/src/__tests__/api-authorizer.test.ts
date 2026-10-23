/**
 * API Authorizer Tests
 *
 * Tests that AdminApi, JmapApi, and McpApi properly wire HttpLambdaAuthorizer
 * to all their routes (except intentionally public routes, if any).
 *
 * Security requirements:
 * - Every API route MUST have an AuthorizerId referencing an AWS::ApiGatewayV2::Authorizer
 * - Routes without explicit authorizer config MUST NOT exist (authType defaults to 'NONE')
 * - An AWS::ApiGatewayV2::Authorizer resource MUST be created for each API
 */

import { ArtifactZone, PinnedArtifactResolver }       from '@serverlessinbox/artifact-registry-cdk';
import type { ArtifactPin, IArtifactResolver }        from '@serverlessinbox/artifact-registry-cdk';
import { Template }                                   from 'aws-cdk-lib/assertions';
import * as acm                                       from 'aws-cdk-lib/aws-certificatemanager';
import * as dynamodb                                  from 'aws-cdk-lib/aws-dynamodb';
import * as lambda                                    from 'aws-cdk-lib/aws-lambda';
import * as s3                                        from 'aws-cdk-lib/aws-s3';
import * as cdk                                       from 'aws-cdk-lib';
import { App, BootstraplessSynthesizer }              from 'aws-cdk-lib';
import { Construct }                                  from 'constructs';

import { AdminApi }                                   from '../core/apis/admin-api';
import { JmapApi }                                    from '../core/apis/jmap-api';
import { McpApi }                                     from '../core/apis/mcp-api';
import { Permission }                                 from '../core/auth/jmap-scopes';
import type { IMailboxAuthProvider }                  from '../core/auth/types';
import { DataBlobStore, type IDataBlobStore }         from '../resources/buckets/data-blob-store';
import { AuditEventsQueue, type IAuditEventsQueue }   from '../resources/queues/audit-events-queue';
import { EmailSendingQueue, type IEmailSendingQueue } from '../resources/queues/email-sending-queue';
import { AuthKeyStoreTable, type IAuthKeyStoreTable } from '../resources/tables/auth-key-store-table';
import { DataTable, type IDataTable }                 from '../resources/tables/data-tables';

import {
  CloudFormationResource,
  isResourceOfType,
} from './iam-test-helpers';
import { createMockAuthProvider } from './mailbox-helpers';

/**
 * Helper to find authorizer resources. Optionally filter by a pattern in the logical ID.
 * CDK generates logical IDs by concatenating path components, so 'admin-api' becomes 'adminapi'.
 */
function findAuthorizerResources(
  resources: Record<string, CloudFormationResource> | undefined,
  apiPattern?: string,
): Array<[string, CloudFormationResource]> {
  const results: Array<[string, CloudFormationResource]> = [];
  if (!resources) {return results;}
  for (const [logicalId, resource] of Object.entries(resources)) {
    if (!isResourceOfType(resource, 'AWS::ApiGatewayV2::Authorizer')) {continue;}
    if (apiPattern) {
      // Remove hyphens from pattern to match CDK's logical ID generation
      const normalizedPattern = apiPattern.replace(/-/g, '');
      if (!logicalId.toLowerCase().includes(normalizedPattern.toLowerCase())) {continue;}
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
  if (!resources) {return routes;}
  for (const [logicalId, resource] of Object.entries(resources)) {
    if (!isResourceOfType(resource, 'AWS::ApiGatewayV2::Route')) {continue;}
    if (apiPattern) {
      // Remove hyphens from pattern to match CDK's logical ID generation
      const normalizedPattern = apiPattern.replace(/-/g, '');
      if (!logicalId.toLowerCase().includes(normalizedPattern.toLowerCase())) {continue;}
    }
    routes.push([logicalId, resource]);
  }
  return routes;
}

describe('API Authorizer Wiring', () => {
  let app: App;
  let stack: cdk.Stack;
  let artifactResolver: IArtifactResolver;
  let configTable: IDataTable;
  let itemTable: IDataTable;
  let changelogTable: IDataTable;
  let auditLogTable: IDataTable;
  let mailFeedbackTable: IDataTable;
  let authKeyStoreTable: IAuthKeyStoreTable;
  let blobStore: IDataBlobStore;
  let emailSubmissionQueue: IEmailSendingQueue;
  let auditEventsQueue: IAuditEventsQueue;
  let identityProvisionerFunction: lambda.IFunction;
  let mockAuthProvider: IMailboxAuthProvider;
  let certificate: acm.ICertificate;

  beforeEach(() => {
    app   = new App();
    stack = new cdk.Stack(app, 'TestStack', {
      env:         { account: '123456789012', region: 'us-west-2' },
      synthesizer: new BootstraplessSynthesizer(),
    });

    // Create artifact resolver
    const packages: Record<string, ArtifactPin> = {
      'mailbox-cdk': { version: '1.0.0', zone: ArtifactZone.REGIONAL },
      'mailbox-go':  { version: '1.0.0', zone: ArtifactZone.REGIONAL },
    };
    artifactResolver                            = new PinnedArtifactResolver({
      packages,
      location:         { bucketBase: 'test-artifacts', project: 'serverlessinbox' },
      deploymentRegion: stack.region,
    });

    // Create minimal required resources
    configTable = new DataTable(new dynamodb.Table(stack, 'config-table', {
      partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
      billingMode:  dynamodb.BillingMode.PAY_PER_REQUEST,
    }));

    itemTable = new DataTable(new dynamodb.Table(stack, 'item-table', {
      partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
      billingMode:  dynamodb.BillingMode.PAY_PER_REQUEST,
    }));

    changelogTable = new DataTable(new dynamodb.Table(stack, 'changelog-table', {
      partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
      billingMode:  dynamodb.BillingMode.PAY_PER_REQUEST,
    }));

    auditLogTable = new DataTable(new dynamodb.Table(stack, 'audit-log-table', {
      partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
      billingMode:  dynamodb.BillingMode.PAY_PER_REQUEST,
    }));

    mailFeedbackTable = new DataTable(new dynamodb.Table(stack, 'mail-feedback-table', {
      partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
      billingMode:  dynamodb.BillingMode.PAY_PER_REQUEST,
    }));

    authKeyStoreTable = new AuthKeyStoreTable(stack, 'auth-key-store-table');

    blobStore            = new DataBlobStore(new s3.Bucket(stack, 'blob-store'));
    emailSubmissionQueue = new EmailSendingQueue(stack, 'email-submission-queue');
    auditEventsQueue     = new AuditEventsQueue(stack, 'audit-events-queue');

    // Identity provisioner function - use a minimal Node.js function for testing
    identityProvisionerFunction = new lambda.Function(stack, 'identity-provisioner', {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'index.handler',
      code:    lambda.Code.fromInline('exports.handler = async () => {};'),
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
        identityProvisioner: identityProvisionerFunction,
        sesRuleSetName:      'test-rule-set',
        sesConfigSetName:    'test-config-set',
        systemSenderAddress: 'noreply@example.com',
        vendorLink:          { vendorAccountIds: ['123456789012'], stackIdentityTagKey: 'serverless-inbox:root-stack' },
      });

      const template  = Template.fromStack(stack);
      const resources = template.toJSON().Resources as Record<string, CloudFormationResource> | undefined;
      if (!resources) {throw new Error('No resources in template');}

      // Verify an Authorizer resource exists
      const authorizers = findAuthorizerResources(resources, 'admin-api');
      expect(authorizers.length).toBeGreaterThan(0);
      if (authorizers.length === 0) {throw new Error('No authorizers found for AdminApi');}
      const [, authorizerResource] = authorizers[0];
      expect(isResourceOfType(authorizerResource, 'AWS::ApiGatewayV2::Authorizer')).toBe(true);

      // Verify all routes have an AuthorizerId
      const routes = findRouteResources(resources, 'admin-api');
      expect(routes.length).toBeGreaterThan(0);

      for (const [, route] of routes) {
        const props        = route.Properties as Record<string, unknown> | undefined;
        const authorizerId = props?.AuthorizerId;
        expect(authorizerId).toBeDefined();      }
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
        identityProvisioner: identityProvisionerFunction,
        sesRuleSetName:      'test-rule-set',
        sesConfigSetName:    'test-config-set',
        systemSenderAddress: 'noreply@example.com',
        vendorLink:          { vendorAccountIds: ['123456789012'], stackIdentityTagKey: 'serverless-inbox:root-stack' },
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

  describe('JmapApi', () => {
    it('should attach HttpLambdaAuthorizer to the HTTP API', () => {
      const apiGroup = new Construct(stack, 'api-group');
      new JmapApi(apiGroup, 'jmap-api', {
        configTable,
        itemTable,
        changelogTable,
        authKeyStoreTable,
        blobStore,
        emailSubmissionQueue,
        auditEventsQueue,
        cdnHost: 'cdn.example.com',
        artifactResolver,
        authProvider:        mockAuthProvider,
        identityProvisioner: identityProvisionerFunction,
        vendorAccountIds:    ['123456789012'],
      });

      const template  = Template.fromStack(stack);
      const resources = template.toJSON().Resources as Record<string, CloudFormationResource> | undefined;
      if (!resources) {throw new Error('No resources in template');}

      // Verify an Authorizer resource exists
      const authorizers = findAuthorizerResources(resources, 'jmap-api');
      expect(authorizers.length).toBeGreaterThan(0);
      const [, authorizerResource] = authorizers[0];
      expect(isResourceOfType(authorizerResource, 'AWS::ApiGatewayV2::Authorizer')).toBe(true);

      // Verify all routes have an AuthorizerId
      const routes = findRouteResources(resources, 'jmap-api');
      expect(routes.length).toBeGreaterThan(0);

      for (const [, route] of routes) {
        const props        = route.Properties as Record<string, unknown> | undefined;
        const authorizerId = props?.AuthorizerId;
        expect(authorizerId).toBeDefined();      }
    });

    it('should verify all three expected routes exist with authorizer', () => {
      const apiGroup = new Construct(stack, 'api-group');
      new JmapApi(apiGroup, 'jmap-api', {
        configTable,
        itemTable,
        changelogTable,
        authKeyStoreTable,
        blobStore,
        emailSubmissionQueue,
        auditEventsQueue,
        cdnHost: 'cdn.example.com',
        artifactResolver,
        authProvider:        mockAuthProvider,
        identityProvisioner: identityProvisionerFunction,
        vendorAccountIds:    ['123456789012'],
      });

      const template  = Template.fromStack(stack);
      const resources = template.toJSON().Resources as Record<string, CloudFormationResource> | undefined;
      if (!resources) {throw new Error('No resources in template');}

      // Find routes for JmapApi
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
      const jmapApi      = new JmapApi(jmapApiGroup, 'jmap-api', {
        configTable,
        itemTable,
        changelogTable,
        authKeyStoreTable,
        blobStore,
        emailSubmissionQueue,
        auditEventsQueue,
        cdnHost: 'cdn.example.com',
        artifactResolver,
        authProvider:        mockAuthProvider,
        identityProvisioner: identityProvisionerFunction,
        vendorAccountIds:    ['123456789012'],
      });

      // Create McpApi with the JMAP authorizer
      new McpApi(apiGroup, 'mcp-api', {
        jmapApiGateway:   jmapApi.httpApi,
        authorizerLambda: jmapApi.authorizerLambda,
        certificate,
        domainName: 'example.com',
        scopeMap:   {
          'mail.read':  [Permission.MAIL_READ],
          'mail.write': [Permission.MAIL_WRITE],
        },
        artifactResolver,
      });

      const template  = Template.fromStack(stack);
      const resources = template.toJSON().Resources as Record<string, CloudFormationResource> | undefined;
      if (!resources) {throw new Error('No resources in template');}

      // Verify an Authorizer resource exists for MCP API
      const authorizers = findAuthorizerResources(resources, 'mcp-api');
      expect(authorizers.length).toBeGreaterThan(0);
      const [, authorizerResource] = authorizers[0];
      expect(isResourceOfType(authorizerResource, 'AWS::ApiGatewayV2::Authorizer')).toBe(true);

      // Verify all routes have an AuthorizerId
      const routes = findRouteResources(resources, 'mcp-api');
      expect(routes.length).toBeGreaterThan(0);

      for (const [, route] of routes) {
        const props        = route.Properties as Record<string, unknown> | undefined;
        const authorizerId = props?.AuthorizerId;
        expect(authorizerId).toBeDefined();      }
    });

    it('should verify proxy route exists with authorizer', () => {
      const apiGroup = new Construct(stack, 'api-group');

      const jmapApiGroup = new Construct(stack, 'jmap-api-group');
      const jmapApi      = new JmapApi(jmapApiGroup, 'jmap-api', {
        configTable,
        itemTable,
        changelogTable,
        authKeyStoreTable,
        blobStore,
        emailSubmissionQueue,
        auditEventsQueue,
        cdnHost: 'cdn.example.com',
        artifactResolver,
        authProvider:        mockAuthProvider,
        identityProvisioner: identityProvisionerFunction,
        vendorAccountIds:    ['123456789012'],
      });

      new McpApi(apiGroup, 'mcp-api', {
        jmapApiGateway:   jmapApi.httpApi,
        authorizerLambda: jmapApi.authorizerLambda,
        certificate,
        domainName: 'example.com',
        scopeMap:   {
          'mail.read':  [Permission.MAIL_READ],
          'mail.write': [Permission.MAIL_WRITE],
        },
        artifactResolver,
      });

      const template  = Template.fromStack(stack);
      const resources = template.toJSON().Resources as Record<string, CloudFormationResource> | undefined;
      if (!resources) {throw new Error('No resources in template');}

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
