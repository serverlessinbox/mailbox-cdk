import * as t from 'typanion';

import {
  isLogicalResourceId,
  isPhysicalResourceId,
  isRequestId,
  isStackId,
  type PhysicalResourceId,
} from './custom-resource-identifiers';

const requestFields = {
  StackId:           isStackId,
  RequestId:         isRequestId,
  LogicalResourceId: isLogicalResourceId,
};

// CloudFormation sends a PhysicalResourceId with every Update and Delete and none with a Create.
const isCreateFields  = t.isPartial({ RequestType: t.isLiteral('Create'), ...requestFields });
const isUpdateFields  = t.isPartial({ RequestType: t.isLiteral('Update'), ...requestFields, PhysicalResourceId: isPhysicalResourceId });
const isDeleteFields  = t.isPartial({ RequestType: t.isLiteral('Delete'), ...requestFields, PhysicalResourceId: isPhysicalResourceId });
const isRequestFields = t.isOneOf([isCreateFields, isUpdateFields, isDeleteFields]);

/** The kind of CloudFormation request a custom resource answers. */
export type RequestType = CustomResourceRequest['RequestType'];

/**
 * The properties the template gave the resource. Every custom resource declares its own, so they stay open
 * until the resource's own handler validates them.
 */
interface RequestProperties {
  readonly ResourceProperties?: unknown;
}

/** An Update also carries the properties the resource had before. */
interface UpdateRequestProperties extends RequestProperties {
  readonly OldResourceProperties?: unknown;
}

/** A Create request: the resource is new, so CloudFormation sends no physical id. */
export type CreateRequest = t.InferType<typeof isCreateFields> & RequestProperties;

/** An Update request: it carries the physical id the resource was last answered with. */
export type UpdateRequest = t.InferType<typeof isUpdateFields> & UpdateRequestProperties;

/** A Delete request: it carries the physical id the resource was last answered with. */
export type DeleteRequest = t.InferType<typeof isDeleteFields> & RequestProperties;

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
 * Accepts a value that has the request type and ids of one request variant. The resource properties are not
 * checked, because their shape belongs to each resource.
 */
export const isCustomResourceRequest = t.makeValidator<unknown, CustomResourceRequest>({
  test: (value, state): value is CustomResourceRequest => isRequestFields(value, state),
});
