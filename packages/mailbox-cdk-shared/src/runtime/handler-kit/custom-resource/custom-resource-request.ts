import * as t from 'typanion';

import {
  isLogicalResourceId,
  isPhysicalResourceId,
  isRequestId,
  isResponseUrl,
  isStackId,
  type PhysicalResourceId,
} from './custom-resource-identifiers';

const requestFields = {
  StackId:           isStackId,
  RequestId:         isRequestId,
  LogicalResourceId: isLogicalResourceId,
  ResponseURL:       isResponseUrl,
  // Every custom resource declares its own properties, so only `stackName` is checked here.
  ResourceProperties: t.isObject({ stackName: t.isOptional(t.isString()) }, { extra: t.isUnknown() }),
};

// CloudFormation sends a PhysicalResourceId with every Update and Delete and none with a Create.
const isCreateFields  = t.isObject({ RequestType: t.isLiteral('Create'), ...requestFields }, { extra: t.isUnknown() });
const isUpdateFields  = t.isObject({ RequestType: t.isLiteral('Update'), ...requestFields, PhysicalResourceId: isPhysicalResourceId }, { extra: t.isUnknown() });
const isDeleteFields  = t.isObject({ RequestType: t.isLiteral('Delete'), ...requestFields, PhysicalResourceId: isPhysicalResourceId }, { extra: t.isUnknown() });
const isRequestFields = t.isOneOf([isCreateFields, isUpdateFields, isDeleteFields]);

/** The kind of CloudFormation request a custom resource answers. */
export type RequestType = CustomResourceRequest['RequestType'];

/** An Update also carries the properties the resource had before, which stay open for the resource to read. */
interface UpdateRequestProperties {
  readonly OldResourceProperties?: unknown;
}

/** A Create request: the resource is new, so CloudFormation sends no physical id. */
export type CreateRequest = t.InferType<typeof isCreateFields>;

/** An Update request: it carries the physical id the resource was last answered with. */
export type UpdateRequest = t.InferType<typeof isUpdateFields> & UpdateRequestProperties;

/** A Delete request: it carries the physical id the resource was last answered with. */
export type DeleteRequest = t.InferType<typeof isDeleteFields>;

/**
 * The fields of a CloudFormation custom-resource request that a Lambda reads, one variant per request type.
 * `wrapHandler`'s event type does not declare `PhysicalResourceId`, so a handler reads its event into this
 * type with `readCustomResourceRequest`.
 */
export type CustomResourceRequest = CreateRequest | UpdateRequest | DeleteRequest;

/** An answer to CloudFormation that carries only the physical id and no attributes. */
export interface CustomResourceAnswer {
  readonly PhysicalResourceId?: PhysicalResourceId;
}

/**
 * Accepts a value that has the request type, the ids and the response URL of one request variant. Of the resource
 * properties only `stackName` is checked; the rest belongs to each resource.
 */
export const isCustomResourceRequest = t.makeValidator<unknown, CustomResourceRequest>({
  test: (value, state): value is CustomResourceRequest => isRequestFields(value, state),
});
