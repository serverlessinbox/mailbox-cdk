import type { Branded }    from './branded';
import { isBrandedString } from './branded';

/**
 * The AWS-wide names that several Lambdas pass between their units next to other identifier kinds, each a
 * string of its own kind so that one kind cannot be passed where another is expected. Every kind has exactly
 * one factory, and the cast to the brand sits in that factory and nowhere else.
 */

/** An AWS region code. */
export type Region = Branded<'Region'>;

/** The name of a DynamoDB table. */
export type TableName = Branded<'TableName'>;

/** The name of a Lambda function. */
export type FunctionName = Branded<'FunctionName'>;

/** The URL of an SQS queue. */
export type QueueUrl = Branded<'QueueUrl'>;

export function toRegion(raw: string): Region {
  return raw as Region;
}

export function toTableName(raw: string): TableName {
  return raw as TableName;
}

export function toFunctionName(raw: string): FunctionName {
  return raw as FunctionName;
}

export function toQueueUrl(raw: string): QueueUrl {
  return raw as QueueUrl;
}

export const isRegion = isBrandedString(toRegion);
