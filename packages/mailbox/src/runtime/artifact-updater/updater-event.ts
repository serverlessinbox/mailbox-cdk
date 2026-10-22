import * as t from 'typanion';

const isResourceProperties = t.isPartial({ ServiceToken: t.isString() });

const cfnRequestFields = {
  ServiceToken:       t.isString(),
  ResponseURL:        t.isString(),
  StackId:            t.isString(),
  RequestId:          t.isString(),
  LogicalResourceId:  t.isString(),
  ResourceType:       t.isString(),
  ResourceProperties: isResourceProperties,
};

const isCreateRequest = t.isPartial({ RequestType: t.isLiteral('Create'), ...cfnRequestFields });
const isUpdateRequest = t.isPartial({
  RequestType:           t.isLiteral('Update'),
  ...cfnRequestFields,
  PhysicalResourceId:    t.isString(),
  OldResourceProperties: isResourceProperties,
});
const isDeleteRequest = t.isPartial({
  RequestType: t.isLiteral('Delete'),
  ...cfnRequestFields,
  PhysicalResourceId: t.isString(),
});

/**
 * Whether the event is a CloudFormation custom-resource request: one of the three request variants with every
 * field CloudFormation sends for it. CloudFormation's contract allows more fields than the schema lists, so
 * unlisted fields are accepted; a request without a listed field is not recognised and would be run as a
 * scheduled event.
 */
export const isCfnTriggerEvent = t.isOneOf([isCreateRequest, isUpdateRequest, isDeleteRequest]);

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
