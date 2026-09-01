/**
 * Options for emitManualFinalize.
 */
export interface EmitManualFinalizeOptions {
  /** The physical resource ID for the response. If not provided, falls back to event.LogicalResourceId. */
  physicalResourceId?: string;
  /** Service name for attribution in logs. */
  service?: string;
}

/**
 * Emit CloudFormation custom-resource finalization details for manual recovery.
 *
 * This is break-glass tooling for releasing custom resources that hang during early-stage
 * development. When a custom resource handler never completes and CloudFormation is stuck
 * waiting on a response, this helper emits a greppable MANUAL_FINALIZE block containing:
 * - The CloudFormation request metadata (stack, logical resource, request type, request ID)
 * - The ResponseURL where CloudFormation expects the response
 * - A ready-to-run curl command to unblock the hung resource
 *
 * The output MUST be visible unconditionally via raw console.log, because a hung custom
 * resource by definition never reaches normal completion paths and therefore cannot emit
 * via a LoggerBuffer (which would buffer the output and never flush). Buffering the
 * finalization details defeats their purpose: an operator reading CloudWatch for a hung
 * resource would never see them.
 *
 * Guard: if the event has no ResponseURL, emit nothing and return silently. This prevents
 * spurious MANUAL_FINALIZE output during smoke-test probes, which do not carry a ResponseURL.
 *
 * @param event - CloudFormation custom-resource event
 * @param options - (optional) configuration object with physicalResourceId and service
 */
export function emitManualFinalize(
  event: {
    ResponseURL?: string;
    StackId?: string;
    RequestId?: string;
    LogicalResourceId?: string;
    RequestType?: string;
    ResourceProperties?: Record<string, any>;
  },
  options?: EmitManualFinalizeOptions,
): void {
  const { physicalResourceId, service } = options ?? {};
  // Guard: if no ResponseURL, this is not a real CFN event (likely a smoke test).
  // Emit nothing and return silently.
  if (!event.ResponseURL) {
    return;
  }

  // Determine which physical resource ID to use
  const finalPhysicalResourceId =
    physicalResourceId ?? event.LogicalResourceId ?? 'unknown';

  // Build the finalization response body that would be sent to CloudFormation.
  // Status is always SUCCESS for this break-glass recovery hint: the purpose is to unblock
  // a hung resource, not to carry actual execution status (which would be sent via normal
  // completion paths). An operator manually sending this curl is releasing the resource.
  const finalizationBody = JSON.stringify({
    Status: 'SUCCESS',
    PhysicalResourceId: finalPhysicalResourceId,
    StackId: event.StackId,
    RequestId: event.RequestId,
    LogicalResourceId: event.LogicalResourceId,
  });

  // Emit greppable lines using raw console.log (not LoggerBuffer).
  // Each line is independently greppable and includes the key detail.
  let firstLine = 'MANUAL_FINALIZE stack=' +
    (event.ResourceProperties?.stackName ?? event.LogicalResourceId ?? 'unknown') +
    ' logical=' +
    (event.LogicalResourceId ?? 'unknown') +
    ' type=' +
    (event.RequestType ?? 'unknown') +
    ' requestId=' +
    (event.RequestId ?? 'unknown');
  if (service) {
    firstLine += ' service=' + service;
  }
  console.log(firstLine);
  console.log('MANUAL_FINALIZE responseUrl=' + event.ResponseURL);
  console.log('MANUAL_FINALIZE body=' + finalizationBody);
  console.log(
    'MANUAL_FINALIZE hint=curl -X PUT -H "Content-Type:" --data-binary \'' +
      finalizationBody +
      '\' \'' +
      event.ResponseURL +
      '\''
  );
}
