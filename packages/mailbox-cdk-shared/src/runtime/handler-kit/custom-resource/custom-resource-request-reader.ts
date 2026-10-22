import { ExpectedFailure }                                     from '../errors/expected-failure';

import { isCustomResourceRequest, type CustomResourceRequest } from './custom-resource-request';

/**
 * Reads the event a custom-resource Lambda received as the request it is. An event that is not one of the three
 * request variants, or that lacks an id its variant carries, is rejected as an `ExpectedFailure` naming each
 * field that was wrong.
 */
export function readCustomResourceRequest(event: unknown): CustomResourceRequest {
  const errors: string[] = [];
  if (!isCustomResourceRequest(event, { errors })) {
    throw new ExpectedFailure(`Invalid custom-resource request: ${errors.join('; ')}`);
  }
  return event;
}
