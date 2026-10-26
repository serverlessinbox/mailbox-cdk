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
import type { TemplateValue }                        from '../../../__tests__/template-resources';
import { DataBlobStore }                             from '../../../resources/buckets/data-blob-store';
import { AuditEventsQueue }                          from '../../../resources/queues/audit-events-queue';
import { EmailSendingQueue }                         from '../../../resources/queues/email-sending-queue';
import { AuthKeyStoreTable }                         from '../../../resources/tables/auth-key-store-table';
import { DataTable }                                 from '../../../resources/tables/data-tables';
import type { AdminApiProps }                        from '../admin-api';

const isRouteProperties = t.isPartial({
  RouteKey:          t.isString(),
  ApiId:             isTemplateValue,
  AuthorizationType: t.isOptional(t.isString()),
  AuthorizerId:      t.isOptional(isTemplateValue),
});

type RouteProperties = t.InferType<typeof isRouteProperties>;

const isRef = t.isPartial({ Ref: t.isString() });

/** An authorizer as the template carries it: its cache TTL and the join that holds the `Arn` attribute of its function. */
const isAuthorizerProperties = t.isPartial({
  AuthorizerResultTtlInSeconds: t.isNumber(),
  AuthorizerUri:                t.isPartial({ 'Fn::Join': t.isTuple([t.isString(), t.isArray(isTemplateValue)]) }),
});

type AuthorizerProperties = t.InferType<typeof isAuthorizerProperties>;

const isFunctionArnAttribute = t.isPartial({ 'Fn::GetAtt': t.isTuple([t.isString(), t.isLiteral('Arn')]) });

const isFunctionProperties = t.isPartial({
  Environment: t.isOptional(t.isPartial({ Variables: t.isOptional(t.isRecord(isTemplateValue)) })),
});

/** What a route's authorizer carries: how long API Gateway caches its answer, and the environment of its Lambda function. */
export interface AuthorizerOfRoute {
  readonly cacheTtlSeconds:     number;
  readonly functionEnvironment: Record<string, TemplateValue>;
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

/** The route `routeKey` as the template carries it. Throws naming the available route keys when it is missing. */
export function routeOf(template: Template, routeKey: string): RouteProperties {
  const routes = resourcesOfType(template, 'AWS::ApiGatewayV2::Route', isRouteProperties).map((route) => route.properties);
  const route  = routes.find((candidate) => candidate.RouteKey === routeKey);

  if (!route) {
    throw new Error(`expected route '${routeKey}', found ${routes.map((candidate) => candidate.RouteKey).join(', ')}`);
  }

  return route;
}

/**
 * The authorizer of the route `routeKey`: follows the route's `AuthorizerId` to the authorizer
 * resource and its `AuthorizerUri` to the Lambda function. Throws naming the step that found
 * nothing, so a test never compares two absent values.
 */
export function authorizerOfRoute(template: Template, routeKey: string): AuthorizerOfRoute {
  const route = routeOf(template, routeKey);

  if (!isRef(route.AuthorizerId)) {
    throw new Error(`route '${routeKey}' has no AuthorizerId reference, found ${JSON.stringify(route.AuthorizerId)}`);
  }
  const authorizer = resourceByLogicalId(template, 'AWS::ApiGatewayV2::Authorizer', isAuthorizerProperties, route.AuthorizerId.Ref, `route '${routeKey}'`);

  const functionLogicalId = functionLogicalIdOf(authorizer, route.AuthorizerId.Ref);
  const lambdaFunction    = resourceByLogicalId(template, 'AWS::Lambda::Function', isFunctionProperties, functionLogicalId, `authorizer '${route.AuthorizerId.Ref}'`);

  const variables = lambdaFunction.Environment?.Variables;
  if (!variables) {
    throw new Error(`function '${functionLogicalId}' of authorizer '${route.AuthorizerId.Ref}' has no environment variables`);
  }

  return { cacheTtlSeconds: authorizer.AuthorizerResultTtlInSeconds, functionEnvironment: variables };
}

function resourceByLogicalId<TProperties>(
  template: Template,
  resourceType: string,
  isProperties: t.StrictValidator<unknown, TProperties>,
  logicalId: string,
  referencedBy: string,
): TProperties {
  const resource = resourcesOfType(template, resourceType, isProperties).find((candidate) => candidate.logicalId === logicalId);

  if (!resource) {
    throw new Error(`${referencedBy} references ${resourceType} '${logicalId}', which the template does not contain`);
  }

  return resource.properties;
}

function functionLogicalIdOf(authorizer: AuthorizerProperties, authorizerLogicalId: string): string {
  const [, parts] = authorizer.AuthorizerUri['Fn::Join'];

  for (const part of parts) {
    if (isFunctionArnAttribute(part)) {
      return part['Fn::GetAtt'][0];
    }
  }

  throw new Error(`AuthorizerUri of authorizer '${authorizerLogicalId}' holds no Arn attribute of a function`);
}
