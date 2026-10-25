import { ArtifactZone, PinnedArtifactResolver }      from '@serverlessinbox/artifact-registry-cdk';
import { ServerlessInboxTagKeys, VENDOR_ACCOUNT_ID } from '@serverlessinbox/mailbox-cdk-shared';
import type { Template }                             from 'aws-cdk-lib/assertions';
import * as acm                                      from 'aws-cdk-lib/aws-certificatemanager';
import { Table, AttributeType }                      from 'aws-cdk-lib/aws-dynamodb';
import { Code, Function as LambdaFunction, Runtime } from 'aws-cdk-lib/aws-lambda';
import { Bucket }                                    from 'aws-cdk-lib/aws-s3';
import * as cdk                                      from 'aws-cdk-lib';
import { App, BootstraplessSynthesizer }             from 'aws-cdk-lib';
import { Construct }                                 from 'constructs';
import * as t                                        from 'typanion';

import { resourcesOfType, isTemplateValue }          from '../../../__tests__/template-resources';
import { DataBlobStore }                             from '../../../resources/buckets/data-blob-store';
import { AuditEventsQueue }                          from '../../../resources/queues/audit-events-queue';
import { EmailSendingQueue }                         from '../../../resources/queues/email-sending-queue';
import { AuthKeyStoreTable }                         from '../../../resources/tables/auth-key-store-table';
import { DataTable }                                 from '../../../resources/tables/data-tables';
import type { AdminApiProps }                        from '../admin-api';

/** The path of the Admin API's own handler route, which every addon route must be protected like. */
const ADMIN_HANDLER_ROUTE_KEY = 'POST /{proxy+}';

const isRouteProperties = t.isPartial({
  RouteKey:          t.isString(),
  ApiId:             isTemplateValue,
  AuthorizationType: t.isOptional(t.isString()),
  AuthorizerId:      t.isOptional(isTemplateValue),
});

type RouteProperties = t.InferType<typeof isRouteProperties>;

/** A route of the template and the Admin API's own handler route, which every addon route must be protected like. */
export interface RouteAndAdminHandlerRoute {
  readonly route:        RouteProperties;
  readonly handlerRoute: RouteProperties;
}

/** A stack in a fixed account and region, synthesized without a bootstrap bucket, as the APIs are deployed. */
export function newApiStack(): cdk.Stack {
  return new cdk.Stack(new App(), 'TestStack', {
    env:         { account: '123456789012', region: 'us-west-2' },
    synthesizer: new BootstraplessSynthesizer(),
  });
}

/** A data table with the string partition key every API test needs. */
export function dataTable(scope: Construct, id: string): DataTable {
  return new DataTable(new Table(scope, id, { partitionKey: { name: 'pk', type: AttributeType.STRING } }));
}

/** A DNS-validated certificate for `domainName`, the input a custom-domain API takes. */
export function certificate(stack: cdk.Stack, domainName: string): acm.Certificate {
  return new acm.Certificate(stack, 'certificate', {
    domainName,
    validation: acm.CertificateValidation.fromDns(),
  });
}

/** A Lambda function with inline code, for a test that needs a function and nothing about its code. */
export function inlineFunction(scope: Construct, id: string): LambdaFunction {
  return new LambdaFunction(scope, id, {
    runtime: Runtime.NODEJS_20_X,
    handler: 'index.handler',
    code:    Code.fromInline('x'),
  });
}

/**
 * The inputs of an `AdminApi`. Every input resource is created under a scope of its own, so the
 * stack stays free for the construct ids of the unit under test.
 */
export function newAdminApiProps(stack: cdk.Stack, overrides: Partial<AdminApiProps> = {}): AdminApiProps {
  const inputs = new Construct(stack, 'admin-api-inputs');

  return {
    configTable:          dataTable(inputs, 'config-table'),
    itemTable:            dataTable(inputs, 'item-table'),
    auditLogTable:        dataTable(inputs, 'audit-log-table'),
    changelogTable:       dataTable(inputs, 'changelog-table'),
    mailFeedbackTable:    dataTable(inputs, 'mail-feedback-table'),
    authKeyStoreTable:    new AuthKeyStoreTable(inputs, 'auth-key-store-table'),
    blobStore:            new DataBlobStore(new Bucket(inputs, 'blob-store')),
    emailSubmissionQueue: new EmailSendingQueue(inputs, 'email-submission-queue'),
    auditEventsQueue:     new AuditEventsQueue(inputs, 'audit-events-queue'),
    artifactResolver:     new PinnedArtifactResolver({
      packages:         {
        'mailbox-cdk': { version: '1.0.0', zone: ArtifactZone.REGIONAL },
        'mailbox-go':  { version: '1.0.0', zone: ArtifactZone.REGIONAL },
      },
      location:         { bucketBase: 'test-artifacts', project: 'serverlessinbox' },
      deploymentRegion: stack.region,
    }),
    identityProvisioner:  LambdaFunction.fromFunctionArn(
      inputs,
      'identity-provisioner-ref',
      `arn:aws:lambda:${stack.region}:${stack.account}:function:identity-provisioner`,
    ),
    sesRuleSetName:       'test-rule-set',
    sesConfigSetName:     'test-config-set',
    systemSenderAddress:  'noreply@example.com',
    vendorLink:           { vendorAccountIds: [VENDOR_ACCOUNT_ID], stackIdentityTagKey: ServerlessInboxTagKeys.rootStack },
    ...overrides,
  };
}

/**
 * The route `routeKey` as the template carries it, together with the Admin API's own handler route
 * on the same HTTP API. Throws when either is missing, so a test never compares two absent values.
 */
export function routeAndAdminHandlerRoute(template: Template, routeKey: string): RouteAndAdminHandlerRoute {
  const routes       = resourcesOfType(template, 'AWS::ApiGatewayV2::Route', isRouteProperties).map((route) => route.properties);
  const route        = routes.find((candidate) => candidate.RouteKey === routeKey);
  const handlerRoute = routes.find((candidate) => candidate.RouteKey === ADMIN_HANDLER_ROUTE_KEY && JSON.stringify(candidate.ApiId) === JSON.stringify(route?.ApiId));

  if (!route || !handlerRoute) {
    throw new Error(`expected '${routeKey}' and '${ADMIN_HANDLER_ROUTE_KEY}' on one HTTP API, found ${routes.map((candidate) => candidate.RouteKey).join(', ')}`);
  }

  return { route, handlerRoute };
}
