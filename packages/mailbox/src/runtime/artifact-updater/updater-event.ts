import type { CloudFormationCustomResourceEvent } from 'aws-lambda';
import * as t                                     from 'typanion';

const hasCfnTriggerFields = t.isPartial({
  RequestType:        t.isString(),
  StackId:            t.isString(),
  ResponseURL:        t.isString(),
  LogicalResourceId:  t.isString(),
  PhysicalResourceId: t.isOptional(t.isString()),
  RequestId:          t.isString(),
});

/**
 * Whether the event is a CloudFormation custom-resource request. Only the fields that tell it from the other
 * events the updater receives are checked; the rest of its shape is CloudFormation's contract, and the schema
 * accepts the fields it does not list.
 */
export const isCfnTriggerEvent = t.makeValidator<unknown, CloudFormationCustomResourceEvent>({
  test: (value, state): value is CloudFormationCustomResourceEvent => hasCfnTriggerFields(value, state),
});

/**
 * What makes an event an API Gateway v2 (HTTP API) request to the updater: it has a request context. Whether
 * the context names a method and path is for the HTTP trigger to read; an event without them is still an HTTP
 * request, and is answered as one.
 */
export const isHttpTriggerEvent = t.isPartial({
  requestContext: t.isPartial({}),
});

/** An HTTP API request to the updater. */
export type HttpTriggerEvent = t.InferType<typeof isHttpTriggerEvent>;

/** The part of an HTTP API request the updater reads to route it: the HTTP method and path. */
export const hasHttpRequestLine = t.isPartial({
  rawPath:        t.isOptional(t.isString()),
  requestContext: t.isPartial({
    http: t.isOptional(
      t.isPartial({
        method: t.isOptional(t.isString()),
        path:   t.isOptional(t.isString()),
      }),
    ),
  }),
});
