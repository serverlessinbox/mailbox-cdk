import type { Unbranded }                   from '../branded';

import type { PhysicalResourceId, StackId } from './custom-resource-identifiers';
import type { CustomResourceRequest }       from './custom-resource-request';

/**
 * The custom-resource properties of a request. Only `stackName` is read; the rest are open because every custom
 * resource declares its own.
 */
export interface ManualFinalizeResourceProperties {
  [property: string]: unknown;
  stackName?: string;
}

/**
 * The fields of a CloudFormation custom-resource request that the break-glass block reads, each optional because
 * an event that is not a real request, such as a smoke-test probe, carries none of them.
 */
export interface ManualFinalizeEvent extends Partial<Unbranded<Pick<CustomResourceRequest, 'RequestType' | 'RequestId' | 'LogicalResourceId'>>> {
  ResponseURL?:        string;
  StackId?:            StackId;
  ResourceProperties?: ManualFinalizeResourceProperties;
}

/**
 * Options for emitManualFinalize.
 */
export interface EmitManualFinalizeOptions {
  /** The physical resource ID for the response. If not provided, falls back to event.LogicalResourceId. */
  physicalResourceId?: PhysicalResourceId;
  /** Service name for attribution in logs. */
  service?: string;
}

/**
 * Break-glass tooling for releasing a custom resource that hangs: writes a greppable MANUAL_FINALIZE block with the
 * request metadata, the ResponseURL CloudFormation waits on, and a ready-to-run curl command that answers SUCCESS.
 * The status is always SUCCESS because an operator sending the curl is releasing the resource, not reporting a result.
 *
 * The block is written with raw console.log, never through a LoggerBuffer: a hung resource never reaches a flush,
 * so buffered lines would never be visible to the operator reading CloudWatch.
 *
 * An event without a ResponseURL is not a real CloudFormation request, such as a smoke-test probe, and writes nothing.
 */
export function emitManualFinalize(event: ManualFinalizeEvent, options?: EmitManualFinalizeOptions): void {
  const { physicalResourceId, service } = options ?? {};
  if (!event.ResponseURL) {
    return;
  }

  const finalizationBody = JSON.stringify({
    Status:             'SUCCESS',
    PhysicalResourceId: physicalResourceId ?? event.LogicalResourceId ?? 'unknown',
    StackId:            event.StackId,
    RequestId:          event.RequestId,
    LogicalResourceId:  event.LogicalResourceId,
  });

  const requestFields = [
    `stack=${event.ResourceProperties?.stackName ?? event.LogicalResourceId ?? 'unknown'}`,
    `logical=${event.LogicalResourceId ?? 'unknown'}`,
    `type=${event.RequestType ?? 'unknown'}`,
    `requestId=${event.RequestId ?? 'unknown'}`,
  ];
  if (service) {
    requestFields.push(`service=${service}`);
  }

  console.log(`MANUAL_FINALIZE ${requestFields.join(' ')}`);
  console.log(`MANUAL_FINALIZE responseUrl=${event.ResponseURL}`);
  console.log(`MANUAL_FINALIZE body=${finalizationBody}`);
  console.log(`MANUAL_FINALIZE hint=curl -X PUT -H "Content-Type:" --data-binary '${finalizationBody}' '${event.ResponseURL}'`);
}
