/**
 * Artifact updater Lambda handler (stack-self-update, Phase B + Phase C).
 *
 * Dispatcher: routes between three trigger types (CFN CR, EventBridge, HTTP API).
 * CFN CR events are routed to cfnTriggerHandler (wrapped with wrapHandler).
 */

import * as t from 'typanion';
import { Context, APIGatewayProxyEventV2 } from 'aws-lambda';
import type { CloudFormationCustomResourceEvent } from 'aws-lambda';
import { cfnTriggerHandler } from './cfn-trigger';
import { handleHttpTrigger } from './http-trigger';
import { runUpdateCycle } from './update-cycle';

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
    PhysicalResourceId: t.isString(),
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
 * Note: The CFN handler (cfnTriggerHandler) is NOT awaited when called from the dispatcher
 * because wrapHandler will send the response to CloudFormation independently and Lambda
 * will handle the async execution. We return its result immediately so Lambda can complete
 * the handler invocation.
 */
export const handler = async (
  event: unknown,
  context?: Context,
): Promise<any> => {
  if (isCfnCrEvent(event)) {
    // CFN CR event: invoke the wrapped handler that guarantees response sent.
    // wrapHandler returns a CloudFormationCustomResourceHandler which has signature:
    // (event, context, callback?) => void | Promise<void>
    // Since wrapHandler handles responses internally, the callback is unused; pass no-op.
    return cfnTriggerHandler(event, context!, () => {});
  }

  if (isHttpApiEvent(event)) {
    return handleHttpTrigger(event);
  }

  // EventBridge or self-invoked: run the update cycle
  return runUpdateCycle();
};
