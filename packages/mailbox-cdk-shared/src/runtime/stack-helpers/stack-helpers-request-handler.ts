import type { CustomResourceRequest }                  from '../handler-kit/custom-resource/custom-resource-request';

import type { StackHelpersData, StackHelpersResolver } from './stack-helpers-resolver';

/** The answer to a `Custom::StackHelpers` request: the resolved attributes, none on Delete. */
export interface StackHelpersAnswer {
  readonly Data?: StackHelpersData;
}

/**
 * Decides how a `Custom::StackHelpers` request is answered: Delete is answered without a lookup, every other
 * request gets the attributes the resolver derives. The CloudFormation response itself is not its concern.
 */
export class StackHelpersRequestHandler {
  private readonly resolver: StackHelpersResolver;

  constructor(resolver: StackHelpersResolver) {
    this.resolver = resolver;
  }

  public async handle(request: CustomResourceRequest): Promise<StackHelpersAnswer> {
    // The resource creates nothing, so there is nothing to undo on Delete.
    if (request.RequestType === 'Delete') {
      return {};
    }

    return { Data: await this.resolver.resolve(request.ResourceProperties, request.StackId) };
  }
}
