import { SFNClient, StartExecutionCommand } from '@aws-sdk/client-sfn';
import { putCfnResponse } from './cfn-response';
import { deleteStackIfExists, describeRecentFailureEvents, describeStack, isTerminalFailure, isTerminalSuccess, makeCfClientFromOp, outputsToObject, safeStringify, startOrUpdateStack } from './cfn-stack';
import { CfnCustomResourceEvent, SfnInvokeEvent } from './types';

const sfnClient = new SFNClient({ region: process.env.AWS_REGION });

// Poll attempt cap: ensures the worker responds within the CR serviceTimeout (60 min),
// with comfortable headroom before CFN gives up. 135 attempts × 20s interval ≈ 45 min.
const MAX_POLL_ATTEMPTS = 135;

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

async function handleSfn(event: SfnInvokeEvent, context: any): Promise<{ done: boolean; deleteRetryCount?: number }> {
  const { mode, cfn, op } = event;
  const deleteRetryCount = typeof (event as any)?.deleteRetryCount === 'number' ? (event as any).deleteRetryCount : 0;
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
      return { done: true, deleteRetryCount };
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
      return { done: false, deleteRetryCount: deleteRetryCount + 1 };
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
      return { done: true, deleteRetryCount };
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
      return { done: true, deleteRetryCount };
    }

    return { done: false, deleteRetryCount };
  }

  if (!stack) {
    await putCfnResponse({
      cfn,
      status: 'FAILED',
      physicalResourceId: op.stackName,
      reason: `Stack ${op.stackName} does not exist`,
      logStreamName: context?.logStreamName,
    });
    return { done: true, deleteRetryCount };
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
    return { done: true, deleteRetryCount };
  }

  if (isTerminalFailure(status)) {
    const failures = await describeRecentFailureEvents(op.stackName, cfClient, 8);
    const details = failures.length > 0 ? ` Recent events: ${failures.join(' | ')}` : '';
    await putCfnResponse({
      cfn,
      status: 'FAILED',
      physicalResourceId: op.stackName,
      reason: limitReason((stack.StackStatusReason ?? `Stack failed with status ${status}`) + details),
      logStreamName: context?.logStreamName,
    });
    return { done: true, deleteRetryCount };
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
    return { done: true, deleteRetryCount };
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
    return { done: true, deleteRetryCount };
  }

  return { done: false, deleteRetryCount };
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
      // Safety net: for Delete, don't wait on a potentially stuck prior execution.
      if (event.RequestType === 'Delete') {
        await putCfnResponse({
          cfn,
          status: 'SUCCESS',
          physicalResourceId,
          reason: 'Delete already in progress (ExecutionAlreadyExists); continuing without waiting',
          logStreamName: context?.logStreamName,
        });
      }
      return;
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

export const starterHandler = async (event: any, context: any): Promise<any> => {
  console.log('Starter event:', JSON.stringify(event, null, 2));
  await handleCfn(event as CfnCustomResourceEvent, context);
};

export const workerHandler = async (event: any, context: any): Promise<any> => {
  console.log('Worker event:', JSON.stringify(event, null, 2));
  return handleSfn(event as SfnInvokeEvent, context);
};
