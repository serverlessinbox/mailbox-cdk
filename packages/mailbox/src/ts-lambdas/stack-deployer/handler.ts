import { SFNClient, StartExecutionCommand, DescribeExecutionCommand } from '@aws-sdk/client-sfn';
import { withSmokeTest } from '@serverlessinbox/mailbox-cdk-shared/smoke-test';
import { putCfnResponse } from './cfn-response';
import { deleteStackIfExists, describeRecentFailureEvents, describeStack, isTerminalFailure, isTerminalSuccess, makeCfClientFromOp, matchesKmsTransientSignature, outputsToObject, recreateStack, requiresRecreate, safeStringify, startOrUpdateStack } from './cfn-stack';
import { CfnCustomResourceEvent, SfnInvokeEvent } from './types';

const sfnClient = new SFNClient({ region: process.env.AWS_REGION });

// Poll attempt cap: ensures the worker responds within the CR serviceTimeout (60 min),
// with comfortable headroom before CFN gives up. 135 attempts × 20s interval ≈ 45 min.
const MAX_POLL_ATTEMPTS = 135;

// CloudFormation truncates auto-generated physical resource names to 64 characters for IAM roles
// and Lambda functions. This limit applies to role names constructed from the stack name.
// A conservative estimate ensures predictable behavior across all resource types.
const MAX_ROOT_STACK_NAME_LENGTH = 24;

// Maximum retries for transient KMS key-availability failures during stack creation.
const MAX_KMS_CREATE_RETRIES = 3;

function limitReason(reason: string, maxLen: number = 3500): string {
  // CloudFormation Reason has a size limit; keep some headroom.
  if (reason.length <= maxLen) return reason;
  return reason.slice(0, maxLen - 20) + ' …(truncated)';
}

function formatAwsError(err: any): string {
  const name = err?.name ? String(err.name) : 'Error';
  const message = err?.message ? String(err.message) : String(err);
  const status = err?.$metadata?.httpStatusCode;
  const requestId = err?.$metadata?.requestId;
  const meta = [
    status ? `http=${status}` : undefined,
    requestId ? `requestId=${requestId}` : undefined,
  ].filter(Boolean).join(' ');
  return meta ? `${name}: ${message} (${meta})` : `${name}: ${message}`;
}

/**
 * Attempt to start a Step Functions execution with retry logic.
 * Tries the base name, then suffixed names (e.g., -r2, -r3, etc.) up to MAX_RETRY_ATTEMPTS.
 * Returns true on success (execution started), false if all retries exhausted.
 */
async function startExecutionWithSuffixRetry(
  executionName: string,
  stateMachineArn: string,
  input: Record<string, any>,
): Promise<boolean> {
  const MAX_RETRY_ATTEMPTS = 5;

  for (let attempt = 2; attempt <= MAX_RETRY_ATTEMPTS; attempt++) {
    const suffixedName = `${executionName}-r${attempt}`;
    try {
      await sfnClient.send(
        new StartExecutionCommand({
          stateMachineArn,
          name: suffixedName,
          input: JSON.stringify(input),
        })
      );
      console.log('Retry execution started successfully', { suffixedName });
      return true;
    } catch (retryErr: any) {
      if (retryErr?.name === 'ExecutionAlreadyExists' || String(retryErr?.message ?? '').includes('ExecutionAlreadyExists')) {
        // The suffixed name also exists (unlikely but possible); continue to next attempt.
        console.warn('Suffixed name also exists (retry)', { suffixedName, error: formatAwsError(retryErr) });
        continue;
      } else {
        // Real error; stop retrying.
        console.error('Retry execution failed (non-ExecutionAlreadyExists)', { suffixedName, error: formatAwsError(retryErr) });
        break;
      }
    }
  }

  // All retries exhausted or a real error occurred.
  return false;
}

async function handleSfn(event: SfnInvokeEvent, context: any): Promise<{ done: boolean; deleteRetryCount?: number; createRetryCount?: number }> {
  const { mode, cfn, op } = event;
  const deleteRetryCount = typeof (event as any)?.deleteRetryCount === 'number' ? (event as any).deleteRetryCount : 0;
  const createRetryCount = typeof (event as any)?.createRetryCount === 'number' ? (event as any).createRetryCount : 0;
  const attempt = typeof event.attempt === 'number' ? event.attempt : 0;

  console.log('Stack deployer op:', JSON.stringify({
    mode,
    requestType: op.requestType,
    stackName: op.stackName,
    templateUrl: op.templateUrl,
    terminationProtection: op.terminationProtection,
    parameterKeys: Object.keys(op.parameters ?? {}),
  }, null, 2));

  const cfClient = makeCfClientFromOp(op);

  const fail = async (err: any, fallbackMessage: string): Promise<{ done: boolean }> => {
    console.error('Stack deployer failed:', err);
    const msg = err ? formatAwsError(err) : fallbackMessage;

    // Try to attach recent stack event reasons (best-effort).
    const failures = await describeRecentFailureEvents(op.stackName, cfClient, 8);
    const details = failures.length > 0 ? ` Recent events: ${failures.join(' | ')}` : '';

    const reason = limitReason(`${fallbackMessage}: ${msg}${details}`);

    // Safety net: never brick the *parent* stack deletion/rollback.
    // For Delete requests, accept leftovers and report SUCCESS.
    await putCfnResponse({
      cfn,
      status: op.requestType === 'Delete' ? 'SUCCESS' : 'FAILED',
      physicalResourceId: op.stackName,
      reason,
      logStreamName: context?.logStreamName,
    });

    return { done: true };
  };

  if (mode === 'start') {
    try {
      if (op.requestType === 'Delete') {
        // If preserveOnDelete is set, skip DeleteStack and return SUCCESS immediately.
        if (op.preserveOnDelete) {
          await putCfnResponse({
            cfn,
            status: 'SUCCESS',
            physicalResourceId: op.stackName,
            data: {},
            logStreamName: context?.logStreamName,
          });
          return { done: true };
        }
        await deleteStackIfExists(op.stackName, cfClient);
      } else {
        await startOrUpdateStack(op);
      }
      return { done: false };
    } catch (err: any) {
      return fail(err, 'Stack deployer start failed');
    }
  }

  // mode === 'check'
  let stack: any | undefined;
  try {
    stack = await describeStack(op.stackName, cfClient);
  } catch (err: any) {
    return fail(err, 'Stack deployer check failed (DescribeStacks)');
  }

  if (op.requestType === 'Delete') {
    if (!stack) {
      await putCfnResponse({
        cfn,
        status: 'SUCCESS',
        physicalResourceId: op.stackName,
        data: {},
        logStreamName: context?.logStreamName,
      });
      return { done: true, deleteRetryCount, createRetryCount };
    }

    const status = stack.StackStatus;

    // DELETE_FAILED is transient: Lambda@Edge replica cleanup happens asynchronously.
    // Always retry DeleteStack on DELETE_FAILED. The 60-minute cap (maxDeletePollAttempts)
    // below is the safety valve — if deletion never succeeds, the deployer responds SUCCESS
    // to avoid blocking parent stack rollback/deletion.
    if (status === 'DELETE_FAILED') {
      const maxDeleteRetries = 180; // ~60 min with 20s interval
      console.log(`Stack delete failed (DELETE_FAILED); retrying delete (deleteRetryCount=${deleteRetryCount}/${maxDeleteRetries}). Reason: ${stack.StackStatusReason ?? 'unknown'}`);
      try {
        await deleteStackIfExists(op.stackName, cfClient);
      } catch (err: any) {
        console.warn('Retry DeleteStack failed (will keep polling):', formatAwsError(err));
      }
      return { done: false, deleteRetryCount: deleteRetryCount + 1, createRetryCount };
    }

    if (isTerminalFailure(status)) {
      const failures = await describeRecentFailureEvents(op.stackName, cfClient, 8);
      const details = failures.length > 0 ? ` Recent events: ${failures.join(' | ')}` : '';

      // Safety net: don't block parent delete/rollback on stack delete failure.
      await putCfnResponse({
        cfn,
        status: 'SUCCESS',
        physicalResourceId: op.stackName,
        reason: limitReason((stack.StackStatusReason ?? `Stack delete failed with status ${status}`) + details),
        logStreamName: context?.logStreamName,
      });
      return { done: true, deleteRetryCount, createRetryCount };
    }

    // Safety net: cap the Delete polling loop so the worker responds before the CloudFormation
    // custom resource serviceTimeout (60 min). On cap, respond SUCCESS to unblock parent stack
    // rollback/deletion; data stack resources are retained via DeletionPolicy.
    if (attempt >= MAX_POLL_ATTEMPTS) {
      console.warn(`Delete polling reached attempt ${attempt}/${MAX_POLL_ATTEMPTS}; responding SUCCESS to unblock CloudFormation (stack status: ${stack.StackStatus}).`);
      await putCfnResponse({
        cfn,
        status: 'SUCCESS',
        physicalResourceId: op.stackName,
        reason: `Stack deletion still in progress after ${attempt} attempts (${stack.StackStatus}); responding SUCCESS to unblock CloudFormation rollback.`,
        logStreamName: context?.logStreamName,
      });
      return { done: true, deleteRetryCount, createRetryCount };
    }

    return { done: false, deleteRetryCount, createRetryCount };
  }

  if (!stack) {
    await putCfnResponse({
      cfn,
      status: 'FAILED',
      physicalResourceId: op.stackName,
      reason: `Stack ${op.stackName} does not exist`,
      logStreamName: context?.logStreamName,
    });
    return { done: true, deleteRetryCount, createRetryCount };
  }

  console.log('Stack status:', JSON.stringify({
    stackName: op.stackName,
    stackId: stack.StackId,
    status: stack.StackStatus,
    statusReason: stack.StackStatusReason,
    outputs: (stack.Outputs ?? []).map((o: any) => ({ key: o.OutputKey, hasValue: o.OutputValue !== undefined && o.OutputValue !== '' })),
  }, null, 2));

  const status = stack.StackStatus;

  // Hard-fail on DELETE_* status during non-Delete operations: a stack being torn down
  // can never satisfy a create/update/redeploy. This blocks unbounded polling on DELETE_IN_PROGRESS.
  if (status.startsWith('DELETE_')) {
    const failures = await describeRecentFailureEvents(op.stackName, cfClient, 8);
    const details = failures.length > 0 ? ` Recent events: ${failures.join(' | ')}` : '';
    await putCfnResponse({
      cfn,
      status: 'FAILED',
      physicalResourceId: op.stackName,
      reason: limitReason(`Stack ${op.stackName} is being deleted (status ${status}); cannot deploy into a deleting stack.` + details),
      logStreamName: context?.logStreamName,
    });
    return { done: true, deleteRetryCount, createRetryCount };
  }

  // Fetch failure events once for potential reuse in retry logic and terminal-failure handling.
  const failures = await describeRecentFailureEvents(op.stackName, cfClient, 8);
  const failureText = failures.join(' ');

  // KMS transient-error retry on Create: if the stack is in ROLLBACK_IN_PROGRESS and the failure
  // matches a KMS NotFoundException signature, wait for rollback to complete without deletion.
  if (op.requestType === 'Create' && status === 'ROLLBACK_IN_PROGRESS' && matchesKmsTransientSignature(failureText)) {
    console.log(`Stack ${op.stackName} is in ROLLBACK_IN_PROGRESS with KMS signature; waiting for rollback to complete (createRetryCount=${createRetryCount}).`);
    return { done: false, deleteRetryCount, createRetryCount };
  }

  // KMS transient-error retry on Create: if the stack is in a recreate state (ROLLBACK_FAILED/ROLLBACK_COMPLETE)
  // with a matching KMS signature, and we haven't exhausted retries, delete and recreate the stack.
  if (op.requestType === 'Create' && requiresRecreate(status) && matchesKmsTransientSignature(failureText) && createRetryCount < MAX_KMS_CREATE_RETRIES) {
    console.log(`Stack ${op.stackName} requires recreation due to KMS transient error (createRetryCount=${createRetryCount}/${MAX_KMS_CREATE_RETRIES}).`);
    try {
      await recreateStack(op, cfClient);
    } catch (err: any) {
      console.error('Recreate CreateStack failed:', formatAwsError(err));
      // Fall through to terminal failure handling.
    }
    return { done: false, deleteRetryCount, createRetryCount: createRetryCount + 1 };
  }

  if (isTerminalFailure(status)) {
    const details = failures.length > 0 ? ` Recent events: ${failures.join(' | ')}` : '';
    await putCfnResponse({
      cfn,
      status: 'FAILED',
      physicalResourceId: op.stackName,
      reason: limitReason((stack.StackStatusReason ?? `Stack failed with status ${status}`) + details),
      logStreamName: context?.logStreamName,
    });
    return { done: true, deleteRetryCount, createRetryCount };
  }

  if (isTerminalSuccess(status)) {
    const outputs = outputsToObject(stack.Outputs);
    console.log('Stack outputs keys:', Object.keys(outputs));
    await putCfnResponse({
      cfn,
      status: 'SUCCESS',
      physicalResourceId: op.stackName,
      data: outputs,
      logStreamName: context?.logStreamName,
    });
    return { done: true, deleteRetryCount, createRetryCount };
  }

  // Cap the non-Delete polling loop so the worker responds within the CR serviceTimeout (60 min).
  // On cap, respond FAILED and stop polling.
  if (attempt >= MAX_POLL_ATTEMPTS) {
    await putCfnResponse({
      cfn,
      status: 'FAILED',
      physicalResourceId: op.stackName,
      reason: limitReason(`Stack ${op.stackName} did not reach a terminal state after ${attempt} attempts (last status ${status})`),
      logStreamName: context?.logStreamName,
    });
    return { done: true, deleteRetryCount, createRetryCount };
  }

  return { done: false, deleteRetryCount, createRetryCount };
}

async function handleCfn(event: CfnCustomResourceEvent, context: any): Promise<void> {
  if (!event?.ResponseURL || !event?.RequestId || !event?.ResourceProperties) {
    throw new Error('Invalid event: expected CloudFormation custom resource event');
  }

  const stateMachineArnRaw = process.env.MAILBOX_STACK_DEPLOYER_STATE_MACHINE_ARN;
  const physicalResourceId = event.ResourceProperties.stackName ?? 'MailboxStack';

  const cfn = {
    ResponseURL: event.ResponseURL,
    StackId: event.StackId,
    RequestId: event.RequestId,
    LogicalResourceId: event.LogicalResourceId,
    ResourceType: event.ResourceType,
  };

  // Operational logging: emit a single, greppable marker with all finalization details
  // for manual stack-resource recovery in CloudWatch (see MANUAL_FINALIZE marker)
  const finalizationBody = JSON.stringify({
    Status: 'SUCCESS', // Placeholder; actual status determined below
    PhysicalResourceId: physicalResourceId,
    StackId: cfn.StackId,
    RequestId: cfn.RequestId,
    LogicalResourceId: cfn.LogicalResourceId,
  });
  console.log('MANUAL_FINALIZE stack=' + event.ResourceProperties.stackName + ' logical=' + event.LogicalResourceId + ' type=' + event.RequestType + ' requestId=' + event.RequestId);
  console.log('MANUAL_FINALIZE responseUrl=' + event.ResponseURL);
  console.log('MANUAL_FINALIZE body=' + finalizationBody);
  console.log('MANUAL_FINALIZE hint=curl -X PUT -H "Content-Type:" --data-binary \'' + finalizationBody + '\' \'' + event.ResponseURL + '\'');

  // Validate root stack name length only on Create to catch configuration issues early.
  // CloudFormation truncates auto-generated physical resource names (64 chars for IAM roles/Lambda functions)
  // for long stack names, which can break name-prefix-based IAM lookups.
  if (event.RequestType === 'Create') {
    // StackId format: arn:aws:cloudformation:region:account-id:stack/stack-name/guid
    const rootStackNameParts = event.StackId.split('/');
    if (rootStackNameParts.length >= 2) {
      const rootStackName = rootStackNameParts[1];
      if (rootStackName.length > MAX_ROOT_STACK_NAME_LENGTH) {
        await putCfnResponse({
          cfn,
          status: 'FAILED',
          physicalResourceId,
          reason: `Root stack name "${rootStackName}" exceeds maximum length of ${MAX_ROOT_STACK_NAME_LENGTH} characters (got ${rootStackName.length}). CloudFormation truncates auto-generated resource names to 64 characters, which can break name-based IAM lookups. Please use a shorter stack name.`,
          logStreamName: context?.logStreamName,
        });
        return;
      }
    }
  }

  if (!stateMachineArnRaw) {
    // Safety net: allow parent stack deletion/rollback to continue.
    const status = event.RequestType === 'Delete' ? 'SUCCESS' : 'FAILED';
    await putCfnResponse({
      cfn,
      status,
      physicalResourceId,
      reason: 'MAILBOX_STACK_DEPLOYER_STATE_MACHINE_ARN is not set',
      logStreamName: context?.logStreamName,
    });
    return;
  }

  // Step Functions state machine ARNs use a colon before the name:
  // arn:aws:states:{region}:{account}:stateMachine:{name}
  // Treat any slash form as a deployment/config error so we have a single source of truth.
  if (stateMachineArnRaw.includes(':stateMachine/')) {
    // Safety net: allow parent stack deletion/rollback to continue.
    const status = event.RequestType === 'Delete' ? 'SUCCESS' : 'FAILED';
    await putCfnResponse({
      cfn,
      status,
      physicalResourceId,
      reason: `MAILBOX_STACK_DEPLOYER_STATE_MACHINE_ARN is invalid (expected ':stateMachine:{name}', got ':stateMachine/{name}'): ${stateMachineArnRaw}`,
      logStreamName: context?.logStreamName,
    });
    return;
  }

  const stateMachineArn = stateMachineArnRaw;

  // Use the CloudFormation RequestId as execution name for natural idempotency.
  // CFN retries keep the same RequestId, so StartExecution can safely return ExecutionAlreadyExists.
  const executionName = event.RequestId;

  const input = {
    cfn,
    op: {
      ...event.ResourceProperties,
      requestType: event.RequestType,
    },
  };

  try {
    await sfnClient.send(
      new StartExecutionCommand({
        stateMachineArn,
        name: executionName,
        input: JSON.stringify(input),
      })
    );
  } catch (err: any) {
    console.error('Failed to start Step Functions execution:', safeStringify(err));
    const message = String(err?.message ?? '');
    if (err?.name === 'ExecutionAlreadyExists' || message.includes('ExecutionAlreadyExists')) {
      // ExecutionAlreadyExists: the same RequestId was retried by CloudFormation.
      // The prior execution is handling (or has handled) the CFN response.
      // For Delete requests, respond SUCCESS and return.
      if (event.RequestType === 'Delete') {
        await putCfnResponse({
          cfn,
          status: 'SUCCESS',
          physicalResourceId,
          reason: 'Delete already in progress (ExecutionAlreadyExists); continuing without waiting',
          logStreamName: context?.logStreamName,
        });
        return;
      }

      // For Create/Update: check if the existing execution is still running.
      // If running, return (it will send the CFN response on its own).
      // If terminal, retry with a suffixed name up to 5 attempts.
      // If retry fails, respond FAILED.
      let executionRunning = false;

      try {
        // Build the execution ARN in colon format: arn:aws:states:region:account:execution:stateMachineName:executionName
        const executionArn = `${stateMachineArn.replace(':stateMachine:', ':execution:')}:${executionName}`;
        const descResp = await sfnClient.send(new DescribeExecutionCommand({ executionArn }));
        const status = descResp.status ?? '';

        if (status === 'RUNNING') {
          // The existing execution is still running; it will send the CFN response.
          console.log('Existing execution is RUNNING; returning without response', { executionArn, status });
          executionRunning = true;
        } else if (['SUCCEEDED', 'FAILED', 'TIMED_OUT', 'ABORTED'].includes(status)) {
          // The existing execution is terminal; try to start a new one with a suffixed name.
          console.log('Existing execution is terminal; attempting retry with suffixed name', { executionArn, status });

          const retrySucceeded = await startExecutionWithSuffixRetry(executionName, stateMachineArn, input);
          if (retrySucceeded) {
            return;
          }

          // All retries exhausted or a real error occurred.
          await putCfnResponse({
            cfn,
            status: 'FAILED',
            physicalResourceId,
            reason: limitReason(`Could not start execution after 5 retries: all suffixed names exhausted`),
            logStreamName: context?.logStreamName,
          });
          return;
        }
      } catch (descErr: any) {
        // DescribeExecution failed (e.g. execution not found, permission denied).
        // Treat as a terminal state and attempt a retry.
        console.warn('DescribeExecution failed; attempting retry with suffixed name', { error: formatAwsError(descErr) });

        const retrySucceeded = await startExecutionWithSuffixRetry(executionName, stateMachineArn, input);
        if (retrySucceeded) {
          return;
        }

        // All retries exhausted.
        await putCfnResponse({
          cfn,
          status: 'FAILED',
          physicalResourceId,
          reason: limitReason(`DescribeExecution failed and could not start retry: ${formatAwsError(descErr)}`),
          logStreamName: context?.logStreamName,
        });
        return;
      }

      // If the existing execution is running, return without sending a response.
      if (executionRunning) {
        return;
      }
    }

    // Safety net: allow parent stack deletion/rollback to continue.
    if (event.RequestType === 'Delete') {
      await putCfnResponse({
        cfn,
        status: 'SUCCESS',
        physicalResourceId,
        reason: limitReason(`Failed to start Step Functions execution (ignored for Delete): ${formatAwsError(err)}`),
        logStreamName: context?.logStreamName,
      });
      return;
    }

    await putCfnResponse({
      cfn,
      status: 'FAILED',
      physicalResourceId,
      reason: limitReason(`Failed to start Step Functions execution: ${formatAwsError(err)}`),
      logStreamName: context?.logStreamName,
    });
  }
}

export const starterHandler = withSmokeTest(async (event: any, context: any): Promise<any> => {
  console.log('Starter event:', JSON.stringify(event, null, 2));
  await handleCfn(event as CfnCustomResourceEvent, context);
});

export const workerHandler = withSmokeTest(async (event: any, context: any): Promise<any> => {
  console.log('Worker event:', JSON.stringify(event, null, 2));
  return handleSfn(event as SfnInvokeEvent, context);
});
