import {
  CloudFormationClient,
  CreateStackCommand,
  DeleteStackCommand,
  DescribeStackEventsCommand,
  DescribeStacksCommand,
  UpdateStackCommand,
} from '@aws-sdk/client-cloudformation';
import { LoggerBuffer } from '@serverlessinbox/mailbox-cdk-shared/lambda-runtime';
import { OperationInput } from './types';

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

export function toCfnTags(tags?: Record<string, string | undefined>): Array<{ Key: string; Value: string }> {
  if (!tags) {
    return [];
  }

  const out: Array<{ Key: string; Value: string }> = [];
  for (const [key, value] of Object.entries(tags)) {
    if (value === undefined || value === '') {
      continue;
    }
    out.push({ Key: key, Value: value });
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

export async function describeRecentFailureEvents(stackName: string, cfClient: CloudFormationClient, limit: number = 10, logger: LoggerBuffer): Promise<string[]> {
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
    logger.warn(`Failed to describe stack events for ${stackName}`, { error: message });
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

export function requiresRecreate(status?: string): boolean {
  // If CloudFormation is stuck in a non-updatable state, delete+recreate is the safest recovery.
  return status === 'ROLLBACK_FAILED' || status === 'ROLLBACK_COMPLETE';
}

export async function startOrUpdateStack(op: OperationInput, logger: LoggerBuffer, getCfClient: (region: string) => CloudFormationClient): Promise<void> {
  const cfClient = getCfClient(op.region ?? process.env.AWS_REGION ?? 'us-east-1');
  const parameters = toCfnParameters(op.parameters);
  const tags = toCfnTags(op.tags);
  // Log parameter keys only (not values, which may contain sensitive data like adminUsername)
  const parameterKeys = parameters.map(p => p.ParameterKey);
  logger.debug('CloudFormation parameters', { parameterKeys });
  logger.debug('CloudFormation tags', { tags });
  logger.debug('Stack operation', {
    stackName: op.stackName,
    templateUrl: op.templateUrl,
    terminationProtection: op.terminationProtection,
  });

  let existing = await describeStack(op.stackName, cfClient);
  if (!existing) {
    try {
      await cfClient.send(
        new CreateStackCommand({
          StackName: op.stackName,
          TemplateURL: op.templateUrl,
          Parameters: parameters,
          Tags: tags,
          Capabilities: ['CAPABILITY_IAM', 'CAPABILITY_NAMED_IAM', 'CAPABILITY_AUTO_EXPAND'],
          EnableTerminationProtection: op.terminationProtection ?? false,
        })
      );
    } catch (err: any) {
      const message = String(err?.message ?? '');
      if (err?.name === 'AlreadyExistsException' || message.includes('already exists')) {
        // Race: stack appeared between describeStack and CreateStack.
        // Re-describe and fall through to the requiresRecreate / UpdateStack path below.
        logger.debug(`Stack ${op.stackName} AlreadyExistsException on CreateStack; re-describing to resolve.`);
        existing = await describeStack(op.stackName, cfClient);
        if (!existing) {
          // Should not happen, but if we still can't see it, re-throw the original error.
          logger.error('CreateStack AlreadyExistsException but stack not found on re-describe', { error: safeStringify(err) });
          throw err;
        }
        // Fall through to requiresRecreate / UpdateStack logic below.
      } else {
        logger.error('CreateStack failed', { error: safeStringify(err) });
        throw err;
      }
    }
    if (!existing) {
      // CreateStack succeeded (existing is still undefined).
      return;
    }
  }

  if (requiresRecreate(existing.StackStatus)) {
    logger.debug(`Stack ${op.stackName} is in ${existing.StackStatus}; deleting and recreating.`);
    await recreateStack(op, cfClient, logger);
    return;
  }

  try {
    await cfClient.send(
      new UpdateStackCommand({
        StackName: op.stackName,
        TemplateURL: op.templateUrl,
        Parameters: parameters,
        Tags: tags,
        Capabilities: ['CAPABILITY_IAM', 'CAPABILITY_NAMED_IAM', 'CAPABILITY_AUTO_EXPAND'],
      })
    );
  } catch (err: any) {
    const message = String(err?.message ?? '');
    if (err?.name === 'ValidationError' && message.includes('No updates are to be performed')) {
      return;
    }
    logger.error('UpdateStack failed', { error: safeStringify(err) });
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

export async function recreateStack(op: OperationInput, cfClient: CloudFormationClient, logger: LoggerBuffer): Promise<void> {
  const parameters = toCfnParameters(op.parameters);
  const tags = toCfnTags(op.tags);
  logger.debug(`Stack ${op.stackName} requires recreation; deleting and recreating.`);
  await deleteStackIfExists(op.stackName, cfClient);
  try {
    await cfClient.send(
      new CreateStackCommand({
        StackName: op.stackName,
        TemplateURL: op.templateUrl,
        Parameters: parameters,
        Tags: tags,
        Capabilities: ['CAPABILITY_IAM', 'CAPABILITY_NAMED_IAM', 'CAPABILITY_AUTO_EXPAND'],
        EnableTerminationProtection: op.terminationProtection ?? false,
      })
    );
  } catch (err: any) {
    logger.error('Recreate CreateStack failed', { error: safeStringify(err) });
    throw err;
  }
}

/**
 * Detects transient KMS key-availability failures on stack create operations.
 *
 * On a fresh account/region, AWS-managed KMS alias/aws/dynamodb exists but its underlying key
 * may not be materialized yet, causing DynamoDB table creation to fail with NotFoundException.
 * This is a transient race condition that resolves with a retry.
 *
 * Signature matcher (case-insensitive): requires both "notfoundexception" AND "kms" to be present
 * in the failure reason text. This conservative predicate avoids false positives on unrelated failures.
 *
 * Real incident example (trimmed):
 * "KMS validation error: com.amazonaws.services.kms.model.NotFoundException: Key 'arn:aws:kms:...' does not exist ... (Service: AWSKMS; ...)"
 */
export function matchesKmsTransientSignature(failureText: string): boolean {
  const lower = failureText.toLowerCase();
  return lower.includes('notfoundexception') && lower.includes('kms');
}

export function makeCfClientFromOp(op: OperationInput, getCfClient: (region: string) => CloudFormationClient): CloudFormationClient {
  return getCfClient(op.region ?? process.env.AWS_REGION ?? 'us-east-1');
}

export function isTerminalSuccess(status?: string): boolean {
  if (!status) return false;
  if (status.startsWith('DELETE_')) return false; // DELETE_COMPLETE is not a deploy success
  return status.endsWith('_COMPLETE') && !status.includes('ROLLBACK');
}

export function isTerminalFailure(status?: string): boolean {
  if (!status) return false;
  return status.includes('ROLLBACK') || status.includes('FAILED');
}
