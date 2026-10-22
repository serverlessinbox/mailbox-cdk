import { InvalidOwnInput }                                     from '../errors/invalid-own-input';

import { isCustomResourceRequest, type CustomResourceRequest } from './custom-resource-request';

/**
 * Reads the event a custom-resource Lambda received as the request it is. An event that is not one of the three
 * request variants, or that lacks an id its variant carries, comes from CloudFormation or our own template, so
 * it is rejected as an `InvalidOwnInput` naming each field that was wrong and carrying the event, minus its
 * response URL and token. It is read before the Lambda has a logger, so there is no trace to flush.
 */
export function readCustomResourceRequest(event: unknown): CustomResourceRequest {
  const errors: string[] = [];
  if (!isCustomResourceRequest(event, { errors })) {
    throw new InvalidOwnInput('Invalid custom-resource request', errors, event);
  }
  return event;
}
