import * as t from 'typanion';
import { ExpectedFailure } from '../shared/expected-failure';
import {
  isCfnRequest,
  isDeletionProperties,
  isSfnInvokeEvent,
  isStackDeployerProperties,
  type CfnRequest,
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
  /** Reads a request far enough to answer it. A request that cannot be answered at all throws a plain error. */
  readCfnRequest(event: unknown): CfnRequest {
    const read = t.as(event, isCfnRequest, { errors: true });
    if (read.errors) {
      throw new Error(`Invalid event: expected a CloudFormation custom resource request: ${read.errors.join('; ')}`);
    }
    return read.value;
  }

  /**
   * Reads the properties of a request that can be answered. Invalid properties throw an ExpectedFailure, the
   * reason the request is answered with, except for a Delete: it proceeds on the properties it needs when
   * those are valid, so that a stack is still deleted.
   */
  readProperties(properties: unknown, requestType: RequestType): BrandedStackDeployerProperties {
    const read = t.as(properties, isStackDeployerProperties, { errors: true });
    if (!read.errors) {
      return read.value;
    }
    if (requestType === 'Delete') {
      return this.readDeletionProperties(properties, read.errors);
    }
    throw new ExpectedFailure(`Invalid ResourceProperties: ${read.errors.join('; ')}`);
  }

  readSfnInvokeEvent(event: unknown): SfnInvokeEvent {
    const read = t.as(event, isSfnInvokeEvent, { errors: true });
    if (read.errors) {
      throw new Error(`Invalid event: expected a stack deployer workflow input: ${read.errors.join('; ')}`);
    }
    return read.value;
  }

  private readDeletionProperties(properties: unknown, fullErrors: string[]): BrandedStackDeployerProperties {
    const read = t.as(properties, isDeletionProperties, { errors: true });
    if (read.errors) {
      throw new ExpectedFailure(`Invalid ResourceProperties: ${fullErrors.join('; ')}`);
    }
    return { stackName: read.value.stackName, region: read.value.region, preserveOnDelete: read.value.preserveOnDelete };
  }
}
