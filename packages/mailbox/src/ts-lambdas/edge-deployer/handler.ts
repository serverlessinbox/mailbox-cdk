import { SFNClient, StartExecutionCommand } from '@aws-sdk/client-sfn';
import { putCfnResponse } from './cfn-response';
import { deleteStackIfExists, describeRecentFailureEvents, describeStack, isTerminalFailure, isTerminalSuccess, outputsToObject, safeStringify, startOrUpdateStack } from './edge-stack';
import { CfnCustomResourceEvent, SfnInvokeEvent } from './types';

const sfnClient = new SFNClient({ region: process.env.AWS_REGION });

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

async function handleSfn(event: SfnInvokeEvent, context: any): Promise<{ done: boolean }> {
  const { mode, cfn, op } = event;

  console.log('Edge deployer op:', JSON.stringify({
    mode,
    requestType: op.requestType,
    stackName: op.stackName,
    templateUrl: op.templateUrl,
    terminationProtection: op.terminationProtection,
    parameterKeys: Object.keys(op.parameters ?? {}),
  }, null, 2));

  const fail = async (err: any, fallbackMessage: string): Promise<{ done: boolean }> => {
    console.error('Edge deployer failed:', err);
    const msg = err ? formatAwsError(err) : fallbackMessage;

    // Try to attach recent edge-stack event reasons (best-effort).
    const failures = await describeRecentFailureEvents(op.stackName, 8);
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
        await deleteStackIfExists(op.stackName);
      } else {
        await startOrUpdateStack(op);
      }
      return { done: false };
    } catch (err: any) {
      return fail(err, 'Edge deployer start failed');
    }
  }

  // mode === 'check'
  let stack: any | undefined;
  try {
    stack = await describeStack(op.stackName);
  } catch (err: any) {
    return fail(err, 'Edge deployer check failed (DescribeStacks)');
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
      return { done: true };
    }

    const status = stack.StackStatus;
    if (isTerminalFailure(status)) {
      const failures = await describeRecentFailureEvents(op.stackName, 8);
      const details = failures.length > 0 ? ` Recent events: ${failures.join(' | ')}` : '';
      // Safety net: don't block parent delete/rollback on edge stack delete failure.
      await putCfnResponse({
        cfn,
        status: 'SUCCESS',
        physicalResourceId: op.stackName,
        reason: limitReason((stack.StackStatusReason ?? `Edge stack delete failed with status ${status}`) + details),
        logStreamName: context?.logStreamName,
      });
      return { done: true };
    }

    return { done: false };
  }

  if (!stack) {
    await putCfnResponse({
      cfn,
      status: 'FAILED',
      physicalResourceId: op.stackName,
      reason: `Edge stack ${op.stackName} does not exist`,
      logStreamName: context?.logStreamName,
    });
    return { done: true };
  }

  console.log('Edge stack status:', JSON.stringify({
    stackName: op.stackName,
    stackId: stack.StackId,
    status: stack.StackStatus,
    statusReason: stack.StackStatusReason,
    outputs: (stack.Outputs ?? []).map((o: any) => ({ key: o.OutputKey, hasValue: o.OutputValue !== undefined && o.OutputValue !== '' })),
  }, null, 2));

  const status = stack.StackStatus;
  if (isTerminalFailure(status)) {
    const failures = await describeRecentFailureEvents(op.stackName, 8);
    const details = failures.length > 0 ? ` Recent events: ${failures.join(' | ')}` : '';
    await putCfnResponse({
      cfn,
      status: 'FAILED',
      physicalResourceId: op.stackName,
      reason: limitReason((stack.StackStatusReason ?? `Edge stack failed with status ${status}`) + details),
      logStreamName: context?.logStreamName,
    });
    return { done: true };
  }

  if (isTerminalSuccess(status)) {
    const outputs = outputsToObject(stack.Outputs);
    console.log('Edge stack outputs keys:', Object.keys(outputs));
    await putCfnResponse({
      cfn,
      status: 'SUCCESS',
      physicalResourceId: op.stackName,
      data: outputs,
      logStreamName: context?.logStreamName,
    });
    return { done: true };
  }

  return { done: false };
}

async function handleCfn(event: CfnCustomResourceEvent, context: any): Promise<void> {
  if (!event?.ResponseURL || !event?.RequestId || !event?.ResourceProperties) {
    throw new Error('Invalid event: expected CloudFormation custom resource event');
  }

  const stateMachineArnRaw = process.env.MAILBOX_EDGE_DEPLOYER_STATE_MACHINE_ARN;
  const physicalResourceId = event.ResourceProperties.stackName ?? 'MailboxEdge';

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
      reason: 'MAILBOX_EDGE_DEPLOYER_STATE_MACHINE_ARN is not set',
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
      reason: `MAILBOX_EDGE_DEPLOYER_STATE_MACHINE_ARN is invalid (expected ':stateMachine:{name}', got ':stateMachine/{name}'): ${stateMachineArnRaw}`,
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

// Backwards compatible entrypoint: routes based on payload shape.
export const handler = async (event: any, context: any): Promise<any> => {
  console.log('Event:', JSON.stringify(event, null, 2));

  if (event && typeof event === 'object' && (event as SfnInvokeEvent).mode) {
    return workerHandler(event, context);
  }

  return starterHandler(event, context);
};
