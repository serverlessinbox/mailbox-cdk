import * as t               from 'typanion';

import { InvalidOwnInput }  from '../../../runtime/handler-kit/errors/invalid-own-input';

import {
  isCfnRequest,
  isCfnTarget,
  isDeletionProperties,
  isPhysicalIdOfRequest,
  isPhysicalIdOfStep,
  isRegionOfRequest,
  isRegionOfStep,
  isRequestTypeOfRequest,
  isRequestTypeOfStep,
  isSfnInvokeEvent,
  isStackDeployerProperties,
  isStackNameOfRequest,
  isStackNameOfStep,
  isTargetOfStep,
  type AnswerableEvent,
  type CfnEnvelope,
  type CfnRequest,
  type CfnTarget,
  type RequestType,
  type BrandedStackDeployerProperties,
  type SfnInvokeEvent,
} from './stack-deployment';

/**
 * Turns the untyped payloads the deployer Lambdas receive into the payload types. An event that is not the
 * expected shape is rejected with the fields that are wrong. Values are read as they arrive: a flag that is a
 * string stays a string.
 */
export class StackDeploymentEventReader {
  /** Reads a request far enough to answer it. A request that is not that far readable throws a plain error. */
  readCfnRequest(event: unknown): CfnRequest {
    const read = t.as(event, isCfnRequest, { errors: true });
    if (read.errors) {
      throw new Error(`Invalid event: expected a CloudFormation custom resource request: ${read.errors.join('; ')}`);
    }
    return read.value;
  }

  /**
   * Reads the properties of a request that can be answered. Properties our own template should never have
   * written throw an `InvalidOwnInput` naming the failing fields and carrying the properties, except for a
   * Delete: it proceeds on the properties it needs when those are valid, so that a stack is still deleted. A
   * Create or an Update without a templateUrl is invalid.
   */
  readProperties(properties: unknown, requestType: RequestType): BrandedStackDeployerProperties {
    const read = t.as(properties, isStackDeployerProperties, { errors: true });
    if (!read.errors) {
      this.requireTemplateUrl(read.value, requestType);
      return read.value;
    }
    if (requestType === 'Delete') {
      return this.readDeletionProperties(properties, read.errors);
    }
    throw new InvalidOwnInput('Invalid ResourceProperties', read.errors, properties);
  }

  readSfnInvokeEvent(event: unknown): SfnInvokeEvent {
    const read = t.as(event, isSfnInvokeEvent, { errors: true });
    if (read.errors) {
      throw new Error(`Invalid event: expected a stack deployer workflow input: ${read.errors.join('; ')}`);
    }
    return read.value;
  }

  /** What a request that cannot be read in full still gives to answer it; undefined when it carries no usable response target. */
  readAnswerableCfnRequest(event: unknown): AnswerableEvent | undefined {
    if (!isCfnTarget(event)) {
      return undefined;
    }
    return {
      cfn:                this.responseTargetOf(event),
      physicalResourceId: isPhysicalIdOfRequest(event) ? event.PhysicalResourceId : undefined,
      requestType:        isRequestTypeOfRequest(event) ? event.RequestType : undefined,
      stackName:          isStackNameOfRequest(event) ? event.ResourceProperties.stackName : undefined,
      region:             isRegionOfRequest(event) ? event.ResourceProperties.region : undefined,
    };
  }

  /** What a workflow input that cannot be read in full still gives to answer it; undefined when it carries no usable response target. */
  readAnswerableSfnInput(event: unknown): AnswerableEvent | undefined {
    if (!isTargetOfStep(event)) {
      return undefined;
    }
    return {
      cfn:                this.responseTargetOf(event.cfn),
      physicalResourceId: isPhysicalIdOfStep(event) ? event.cfn.PhysicalResourceId : undefined,
      requestType:        isRequestTypeOfStep(event) ? event.op.requestType : undefined,
      stackName:          isStackNameOfStep(event) ? event.op.stackName : undefined,
      region:             isRegionOfStep(event) ? event.op.region : undefined,
    };
  }

  private responseTargetOf(target: CfnTarget): CfnEnvelope {
    return {
      ResponseURL:       target.ResponseURL,
      StackId:           target.StackId,
      RequestId:         target.RequestId,
      LogicalResourceId: target.LogicalResourceId,
      ResourceType:      target.ResourceType,
    };
  }

  private requireTemplateUrl(properties: BrandedStackDeployerProperties, requestType: RequestType): void {
    if (requestType !== 'Delete' && properties.templateUrl === undefined) {
      throw new InvalidOwnInput('Invalid ResourceProperties', [`.templateUrl is required for a ${requestType}`], properties);
    }
  }

  private readDeletionProperties(properties: unknown, fullErrors: string[]): BrandedStackDeployerProperties {
    const read = t.as(properties, isDeletionProperties, { errors: true });
    if (read.errors) {
      throw new InvalidOwnInput('Invalid ResourceProperties', fullErrors, properties);
    }
    return { stackName: read.value.stackName, region: read.value.region, preserveOnDelete: read.value.preserveOnDelete };
  }
}
