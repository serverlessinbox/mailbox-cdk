import {
  CloudFormationClient,
  CreateStackCommand,
  DeleteStackCommand,
  DescribeStackEventsCommand,
  DescribeStacksCommand,
  UpdateStackCommand,
} from '@aws-sdk/client-cloudformation';
import { OperationInput } from './types';

function makeCfClient(region: string): CloudFormationClient {
  return new CloudFormationClient({ region });
}

export function toCfnParameters(parameters?: Record<string, string | undefined>): Array<{ ParameterKey: string; ParameterValue: string }> {
  if (!parameters) {
    return [];
  }

  const out: Array<{ ParameterKey: string; ParameterValue: string }> = [];
  for (const [key, value] of Object.entries(parameters)) {
    if (value === undefined || value === '') {
      continue;
    }
    out.push({ ParameterKey: key, ParameterValue: value });
  }
  return out;
}

export async function describeStack(stackName: string, cfClient: CloudFormationClient): Promise<any | undefined> {
  try {
    const resp = await cfClient.send(new DescribeStacksCommand({ StackName: stackName }));
    return resp.Stacks?.[0];
  } catch (err: any) {
    if (err?.name === 'ValidationError' && String(err?.message ?? '').includes('does not exist')) {
      return undefined;
    }
    throw err;
  }
}

export async function describeRecentFailureEvents(stackName: string, cfClient: CloudFormationClient, limit: number = 10): Promise<string[]> {
  try {
    const resp = await cfClient.send(new DescribeStackEventsCommand({ StackName: stackName }));
    const events = resp.StackEvents ?? [];
    const lines: string[] = [];

    for (const e of events) {
      if (lines.length >= limit) {
        break;
      }

      const status = e.ResourceStatus ?? '';
      // CloudFormation commonly records actionable reasons on UPDATE_FAILED / CREATE_FAILED,
      // and sometimes only indicates rollback/cancel at the resource level.
      if (!(status.includes('FAILED') || status.includes('ROLLBACK') || status.includes('CANCEL'))) {
        continue;
      }

      const logicalId = e.LogicalResourceId ?? 'UnknownLogicalId';
      const type = e.ResourceType ?? 'UnknownType';
      const reason = e.ResourceStatusReason ?? 'Unknown reason';
      lines.push(`${logicalId} (${type}) ${status}: ${reason}`);
    }

    return lines;
  } catch (err: any) {
    const message = String(err?.message ?? err);
    console.warn(`Failed to describe stack events for ${stackName}: ${message}`);
    return [];
  }
}

export function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function outputsToObject(outputs?: Array<{ OutputKey?: string; OutputValue?: string }>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const o of outputs ?? []) {
    if (o.OutputKey && o.OutputValue !== undefined) {
      out[o.OutputKey] = o.OutputValue;
    }
  }
  return out;
}

function requiresRecreate(status?: string): boolean {
  // If CloudFormation is stuck in a non-updatable state, delete+recreate is the safest recovery.
  return status === 'ROLLBACK_FAILED' || status === 'ROLLBACK_COMPLETE';
}

export async function startOrUpdateStack(op: OperationInput): Promise<void> {
  const cfClient = makeCfClient(op.region ?? process.env.AWS_REGION ?? 'us-east-1');
  const parameters = toCfnParameters(op.parameters);
  console.log('CloudFormation parameters:', JSON.stringify(parameters, null, 2));
  console.log('Stack operation:', JSON.stringify({
    stackName: op.stackName,
    templateUrl: op.templateUrl,
    terminationProtection: op.terminationProtection,
  }, null, 2));

  const existing = await describeStack(op.stackName, cfClient);
  if (!existing) {
    try {
      await cfClient.send(
        new CreateStackCommand({
          StackName: op.stackName,
          TemplateURL: op.templateUrl,
          Parameters: parameters,
          Capabilities: ['CAPABILITY_IAM', 'CAPABILITY_NAMED_IAM', 'CAPABILITY_AUTO_EXPAND'],
          EnableTerminationProtection: op.terminationProtection ?? false,
        })
      );
    } catch (err: any) {
      console.error('CreateStack failed:', safeStringify(err));
      throw err;
    }
    return;
  }

  if (requiresRecreate(existing.StackStatus)) {
    console.log(`Stack ${op.stackName} is in ${existing.StackStatus}; deleting and recreating.`);
    await deleteStackIfExists(op.stackName, cfClient);
    try {
      await cfClient.send(
        new CreateStackCommand({
          StackName: op.stackName,
          TemplateURL: op.templateUrl,
          Parameters: parameters,
          Capabilities: ['CAPABILITY_IAM', 'CAPABILITY_NAMED_IAM', 'CAPABILITY_AUTO_EXPAND'],
          EnableTerminationProtection: op.terminationProtection ?? false,
        })
      );
    } catch (err: any) {
      console.error('Recreate CreateStack failed:', safeStringify(err));
      throw err;
    }
    return;
  }

  try {
    await cfClient.send(
      new UpdateStackCommand({
        StackName: op.stackName,
        TemplateURL: op.templateUrl,
        Parameters: parameters,
        Capabilities: ['CAPABILITY_IAM', 'CAPABILITY_NAMED_IAM', 'CAPABILITY_AUTO_EXPAND'],
      })
    );
  } catch (err: any) {
    const message = String(err?.message ?? '');
    if (err?.name === 'ValidationError' && message.includes('No updates are to be performed')) {
      return;
    }
    console.error('UpdateStack failed:', safeStringify(err));
    throw err;
  }
}

export async function deleteStackIfExists(stackName: string, cfClient: CloudFormationClient): Promise<void> {
  const existing = await describeStack(stackName, cfClient);
  if (!existing) {
    return;
  }
  await cfClient.send(new DeleteStackCommand({ StackName: stackName }));
}

export function makeCfClientFromOp(op: OperationInput): CloudFormationClient {
  return makeCfClient(op.region ?? process.env.AWS_REGION ?? 'us-east-1');
}

export function isTerminalSuccess(status?: string): boolean {
  if (!status) return false;
  return status.endsWith('_COMPLETE') && !status.includes('ROLLBACK');
}

export function isTerminalFailure(status?: string): boolean {
  if (!status) return false;
  return status.includes('ROLLBACK') || status.includes('FAILED');
}
