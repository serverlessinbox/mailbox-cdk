/**
 * Artifact updater Lambda handler (stack-self-update, Phase B + Phase C).
 *
 * Dispatcher: routes between three trigger types (CFN CR, EventBridge, HTTP API).
 * CFN CR events are routed to cfnTriggerHandler (wrapped with wrapHandler).
 */

import { CloudFrontClient } from '@aws-sdk/client-cloudfront';
import { LambdaClient } from '@aws-sdk/client-lambda';
import { ResourceGroupsTaggingAPIClient } from '@aws-sdk/client-resource-groups-tagging-api';
import { S3Client } from '@aws-sdk/client-s3';
import * as t from 'typanion';
import { Context, APIGatewayProxyEventV2 } from 'aws-lambda';
import type { CloudFormationCustomResourceEvent } from 'aws-lambda';
import { env, LoggerBuffer } from '@serverlessinbox/mailbox-cdk-shared/lambda-runtime';
import { load } from './config';
import type { UpdaterRuntime } from './updater-runtime';
import { createCfnTriggerHandler } from './cfn-trigger';
import { handleHttpTrigger } from './http-trigger';
import { runUpdateCycle } from './update-cycle';
import { EDGE_REGION, type RegionClients, type UpdaterClients } from './updater-clients';

/**
 * Typanion schema for CloudFormation custom resource event discrimination.
 *
 * Checks for the presence of 6 discriminating fields that uniquely identify CFN CR events.
 * Real CFN events contain additional fields (ResourceType, ResourceProperties, ServiceToken, etc.).
 * The `extra: t.isRecord(t.isUnknown())` option allows typanion's isObject to accept objects
 * with properties beyond the ones specified in the schema (typanion's isObject rejects extra
 * properties by default, unlike isPartial).
 */
const cfnCrEventSchema = t.isObject(
  {
    RequestType: t.isString(),
    StackId: t.isString(),
    ResponseURL: t.isString(),
    LogicalResourceId: t.isString(),
    // PhysicalResourceId is omitted from CloudFormation Create events; only Update and Delete carry it.
    // See @types/aws-lambda's CloudFormationCustomResourceEvent discriminated union.
    PhysicalResourceId: t.isOptional(t.isString()),
    RequestId: t.isString(),
  },
  { extra: t.isRecord(t.isUnknown()) },
);

/**
 * Typanion schema for API Gateway v2 (HTTP API) event discrimination.
 *
 * Checks for the nested requestContext.http structure that uniquely identifies HTTP API v2 events.
 * Real HTTP API v2 events have many additional properties at the top level (version, routeKey,
 * rawPath, headers, body, etc.) and within requestContext (routeKey, stage, requestId, accountId, etc.).
 * Both levels use the `extra` option to allow unrelated properties.
 */
const httpApiEventSchema = t.isObject(
  {
    requestContext: t.isObject(
      {
        http: t.isUnknown(),
      },
      { extra: t.isRecord(t.isUnknown()) },
    ),
  },
  { extra: t.isRecord(t.isUnknown()) },
);

/** Check if the event is a CloudFormation custom resource event. */
function isCfnCrEvent(event: unknown): event is CloudFormationCustomResourceEvent {
  return cfnCrEventSchema(event);
}

/** Check if the event is an API Gateway v2 (HTTP API) event. */
function isHttpApiEvent(event: unknown): event is APIGatewayProxyEventV2 {
  return httpApiEventSchema(event);
}

/**
 * Dispatcher: routes to CFN handler, HTTP trigger, or update cycle.
 *
 * CFN CR events: routed to cfnTriggerHandler (wrapped with wrapHandler)
 * HTTP API events: routed to handleHttpTrigger
 * EventBridge/self-invoked: runs update cycle directly
 *
 * Note: The CFN handler (cfnTriggerHandler) is awaited; this async function returns its Promise,
 * so the Lambda runtime waits for the full chain (including wrapHandler's HTTPS response PUT)
 * before considering the invocation complete.
 */
export function createHandler(runtime: UpdaterRuntime) {
  return async (
    event: unknown,
    context?: Context,
  ): Promise<any> => {
    // Compute dispatch mode once, log it via a single direct call — this line always emits
    // regardless of outcome, so it never participates in LoggerBuffer's suppressed trace
    // (see buffered-logging-pattern skill's narrow exception for always-on diagnostic markers).
    const cfnCr = isCfnCrEvent(event);
    const httpApi = !cfnCr && isHttpApiEvent(event);
    console.info('artifact-updater dispatch', {
      mode: cfnCr ? 'cfn-custom-resource' : httpApi ? 'http-api' : 'eventbridge-or-self-invoke',
    });

    if (cfnCr) {
      // CFN CR event: invoke the wrapped handler that guarantees response sent.
      // wrapHandler returns a CloudFormationCustomResourceHandler which has signature:
      // (event, context, callback?) => void | Promise<void>
      // Since wrapHandler handles responses internally, the callback is unused; pass no-op.
      const cfnTriggerHandler = createCfnTriggerHandler(runtime);
      return cfnTriggerHandler(event, context!, () => {});
    }

    if (httpApi) {
      if (runtime.error !== undefined) {
        const logger = new LoggerBuffer();
        logger.error('Configuration error', { error: runtime.error });
        logger.flush();
        return { statusCode: 500, body: JSON.stringify({ error: `Configuration error: ${runtime.error}` }) };
      }
      return handleHttpTrigger(event, runtime.config, runtime.clients.deployment.lambda);
    }

    // EventBridge or self-invoked: run the update cycle
    if (runtime.error !== undefined) throw new Error(runtime.error);
    return runUpdateCycle(runtime.config, runtime.clients);
  };
}

function buildRegionClients(region: string): RegionClients {
  return {
    region,
    lambda: new LambdaClient({ region }),
    tagging: new ResourceGroupsTaggingAPIClient({ region }),
  };
}

function buildUpdaterClients(deploymentRegion: string): UpdaterClients {
  const deployment = buildRegionClients(deploymentRegion);
  return {
    // Artifact and pointer buckets are per-region, so reads follow S3 region redirects.
    registryS3: new S3Client({ region: deploymentRegion, followRegionRedirects: true }),
    deployment,
    edge: deploymentRegion === EDGE_REGION ? deployment : buildRegionClients(EDGE_REGION),
    cloudFront: new CloudFrontClient({ region: EDGE_REGION }),
  };
}

function loadUpdaterRuntime(): UpdaterRuntime {
  const { config, error } = env.tryLoad(load);
  if (error !== undefined) {
    return { config, clients: undefined, error };
  }
  return { config, clients: buildUpdaterClients(config.region), error: undefined };
}

export const handler = createHandler(loadUpdaterRuntime());
