import type { Branded }    from '../branded';
import { isBrandedString } from '../branded';

/**
 * The identifiers of a CloudFormation custom-resource request that several Lambdas pass between their units,
 * each a string of its own kind so that one kind cannot be passed where another is expected. Every kind has
 * exactly one factory, and the cast to the brand sits in that factory and nowhere else.
 */

/** The name of a CloudFormation stack, as it is given to the API calls. */
export type StackName = Branded<'StackName'>;

/** The ARN-form id CloudFormation assigns to a stack. */
export type StackId = Branded<'StackId'>;

/** The logical id of the custom resource in the template that declared it. */
export type LogicalResourceId = Branded<'LogicalResourceId'>;

/** The id CloudFormation gives to one custom-resource request; it stays the same when CloudFormation retries the request. */
export type RequestId = Branded<'RequestId'>;

/** The physical id a custom resource answers CloudFormation with. */
export type PhysicalResourceId = Branded<'PhysicalResourceId'>;

/** The pre-signed URL a custom-resource answer is PUT to. */
export type ResponseUrl = Branded<'ResponseUrl'>;

export function toStackName(raw: string): StackName {
  return raw as StackName;
}

export function toStackId(raw: string): StackId {
  return raw as StackId;
}

export function toLogicalResourceId(raw: string): LogicalResourceId {
  return raw as LogicalResourceId;
}

export function toRequestId(raw: string): RequestId {
  return raw as RequestId;
}

export function toPhysicalResourceId(raw: string): PhysicalResourceId {
  return raw as PhysicalResourceId;
}

export function toResponseUrl(raw: string): ResponseUrl {
  return raw as ResponseUrl;
}

export const isStackName = isBrandedString(toStackName);
export const isStackId = isBrandedString(toStackId);
export const isLogicalResourceId = isBrandedString(toLogicalResourceId);
export const isRequestId = isBrandedString(toRequestId);
export const isResponseUrl = isBrandedString(toResponseUrl);
export const isPhysicalResourceId = isBrandedString(toPhysicalResourceId);
