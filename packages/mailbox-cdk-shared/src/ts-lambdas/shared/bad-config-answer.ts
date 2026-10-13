import type { CustomResourceAnswer, CustomResourceRequest } from './custom-resource-request';

/**
 * Answers a custom-resource request when the Lambda's configuration failed to load. A Delete is answered
 * SUCCESS with the incoming physical id, because a stack in DELETE_FAILED cannot be updated and a failing
 * Delete would leave the bad configuration unfixable. Any other request throws the configuration error.
 * There is no logger before the configuration loads, so the Delete is logged straight to the console.
 */
export function answerRequestWithBadConfig(request: CustomResourceRequest, configError: string): CustomResourceAnswer {
  if (request.RequestType === 'Delete') {
    console.error('Configuration error on Delete; responding SUCCESS so stack deletion is not blocked', { error: configError });
    return { PhysicalResourceId: request.PhysicalResourceId };
  }
  throw new Error(configError);
}
