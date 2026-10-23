import { ExpectedFailure } from '@serverlessinbox/mailbox-cdk-shared/lambda-runtime';
import * as t              from 'typanion';

// CloudFront defines the origin-request event; only the fields the authorizer reads or writes are listed.
const isHeaders = t.isRecord(t.isArray(t.isPartial({
  key:   t.isOptional(t.isString()),
  value: t.isOptional(t.isString()),
})));

const isCloudFrontRequest = t.isPartial({
  method:      t.isString(),
  uri:         t.isOptional(t.isString()),
  querystring: t.isOptional(t.isString()),
  headers:     isHeaders,
  origin:      t.isOptional(t.isPartial({
    s3: t.isOptional(t.isPartial({
      customHeaders: t.isOptional(isHeaders),
    })),
  })),
});

const isCloudFrontEvent = t.isPartial({
  Records: t.cascade(
    t.isArray(t.isPartial({ 'cf': t.isPartial({ request: isCloudFrontRequest }) })),
    [t.hasMinLength(1)],
  ),
});

/** The request of a CloudFront origin-request event, as far as the authorizer reads or rewrites it. */
export type CloudFrontRequest = t.InferType<typeof isCloudFrontRequest>;

/** Request or origin headers: each lower-cased header name maps to its values. */
export type CloudFrontHeaders = t.InferType<typeof isHeaders>;

/**
 * The request of the first record of a CloudFront origin-request event, which is the object the function
 * rewrites and returns. An event of any other shape is refused as an `ExpectedFailure`.
 */
export function readOriginRequest(event: unknown): CloudFrontRequest {
  const errors: string[] = [];
  if (!isCloudFrontEvent(event, { errors })) {
    throw new ExpectedFailure(`Malformed CloudFront event: ${errors.join('; ')}`);
  }
  return event.Records[0].cf.request;
}

/** The first value of a header, or `undefined` when the header is absent or has no value. */
export function firstHeaderValue(headers: CloudFrontHeaders | undefined, name: string): string | undefined {
  return headers?.[name]?.[0]?.value;
}
