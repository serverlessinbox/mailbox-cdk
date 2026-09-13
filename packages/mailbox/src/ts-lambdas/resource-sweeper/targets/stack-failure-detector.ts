import {
  EventBridgeClient,
  ListTagsForResourceCommand,
  RemoveTargetsCommand,
  DeleteRuleCommand,
} from '@aws-sdk/client-eventbridge';
import { LambdaClient, GetFunctionCommand, DeleteFunctionCommand } from '@aws-sdk/client-lambda';
import { IAMClient, ListRoleTagsCommand, DeleteRolePolicyCommand, DeleteRoleCommand } from '@aws-sdk/client-iam';
import { LoggerBuffer } from '@serverlessinbox/mailbox-cdk-shared/lambda-runtime';
import type { StackFailureDetectorRemovalInput, TargetResult } from './types';

interface StepResult {
  status: 'done' | 'retry' | 'failed';
  reason?: string;
}

/** Removes the detector's EventBridge rule. ResourceNotFoundException → already done. */
async function sweepRule(input: StackFailureDetectorRemovalInput, logger: LoggerBuffer, eventsClient: EventBridgeClient): Promise<StepResult> {
  const ruleName = input.ruleArn.split('/').pop()!;
  try {
    try {
      logger.debug('Verifying EventBridge rule ownership');
      const tagsResp = await eventsClient.send(new ListTagsForResourceCommand({ ResourceARN: input.ruleArn }));
      const tags = tagsResp.Tags ?? [];
      const ownerTag = tags.find((t) => t.Key === 'serverless-inbox:root-stack');
      if (ownerTag?.Value !== input.rootStackName) {
        logger.warn('EventBridge rule ownership mismatch', {
          expectedStack: input.rootStackName,
          actualStack: ownerTag?.Value,
        });
        return {
          status: 'failed',
          reason: `Ownership mismatch (expected ${input.rootStackName}, got ${ownerTag?.Value})`,
        };
      }

      logger.info('EventBridge rule ownership verified; removing targets and deleting');
      if (input.ruleTargetId) {
        await eventsClient.send(new RemoveTargetsCommand({ Rule: ruleName, Ids: [input.ruleTargetId] }));
      }
      await eventsClient.send(new DeleteRuleCommand({ Name: ruleName }));
      logger.info('EventBridge rule deleted successfully');
      return { status: 'done' };
    } catch (err: any) {
      if (err.name === 'ResourceNotFoundException') {
        logger.debug('EventBridge rule not found; treating as deleted');
        return { status: 'done' };
      }
      throw err;
    }
  } catch (err: any) {
    logger.error('EventBridge rule deletion error', { errorName: err?.name, errorMessage: err?.message });
    return { status: 'failed', reason: `${err?.name}: ${err?.message}` };
  }
}

/**
 * Removes the detector Lambda function — same shape as `edge-fn.ts`, but in the STACK'S OWN
 * region (not us-east-1): the stack-failure detector is a regular regional Lambda.
 */
async function sweepDetectorFn(input: StackFailureDetectorRemovalInput, logger: LoggerBuffer, lambdaClient: LambdaClient): Promise<StepResult> {
  try {
    const functionName = input.detectorFnArn.split(':').pop()!;

    try {
      logger.debug('Verifying detector Lambda function ownership');
      const getResp = await lambdaClient.send(new GetFunctionCommand({ FunctionName: functionName }));
      const tags = getResp.Tags ?? {};
      const ownerStack = tags['serverless-inbox:root-stack'];
      if (ownerStack !== input.rootStackName) {
        logger.warn('Detector Lambda function ownership mismatch', {
          expectedStack: input.rootStackName,
          actualStack: ownerStack,
        });
        return {
          status: 'failed',
          reason: `Ownership mismatch (expected ${input.rootStackName}, got ${ownerStack})`,
        };
      }

      logger.info('Detector Lambda function ownership verified; attempting delete');
      await lambdaClient.send(new DeleteFunctionCommand({ FunctionName: functionName }));
      logger.info('Detector Lambda function deleted successfully');
      return { status: 'done' };
    } catch (err: any) {
      if (err.name === 'ResourceNotFoundException') {
        logger.debug('Detector Lambda function not found; treating as deleted');
        return { status: 'done' };
      }
      throw err;
    }
  } catch (err: any) {
    logger.error('Detector Lambda function deletion error', {
      errorName: err?.name,
      errorMessage: err?.message,
    });
    return { status: 'failed', reason: `${err?.name}: ${err?.message}` };
  }
}

/**
 * Removes the detector's IAM role. iam:DeleteRole can 409 (DeleteConflictException) while an
 * attached policy is still draining — that is the one genuinely retryable case here.
 * NoSuchEntityException → already done.
 */
async function sweepDetectorRole(input: StackFailureDetectorRemovalInput, logger: LoggerBuffer, iamClient: IAMClient): Promise<StepResult> {
  const roleName = input.detectorRoleArn.split('/').pop()!;

  try {

    try {
      logger.debug('Verifying detector IAM role ownership');
      const tagsResp = await iamClient.send(new ListRoleTagsCommand({ RoleName: roleName }));
      const tags = tagsResp.Tags ?? [];
      const ownerTag = tags.find((t) => t.Key === 'serverless-inbox:root-stack');
      if (ownerTag?.Value !== input.rootStackName) {
        logger.warn('Detector IAM role ownership mismatch', {
          expectedStack: input.rootStackName,
          actualStack: ownerTag?.Value,
        });
        return {
          status: 'failed',
          reason: `Ownership mismatch (expected ${input.rootStackName}, got ${ownerTag?.Value})`,
        };
      }

      logger.info('Detector IAM role ownership verified; deleting policy and role');
      if (input.detectorRolePolicyName) {
        try {
          await iamClient.send(
            new DeleteRolePolicyCommand({ RoleName: roleName, PolicyName: input.detectorRolePolicyName }),
          );
        } catch (err: any) {
          if (err.name !== 'NoSuchEntityException') throw err;
        }
      }
      try {
        await iamClient.send(new DeleteRoleCommand({ RoleName: roleName }));
        logger.info('Detector IAM role deleted successfully');
        return { status: 'done' };
      } catch (err: any) {
        if (err.name === 'DeleteConflictException') {
          logger.info('Detector IAM role still has attached policies; will retry');
          return { status: 'retry', reason: 'DeleteConflictException' };
        }
        throw err;
      }
    } catch (err: any) {
      if (err.name === 'NoSuchEntityException') {
        logger.debug('Detector IAM role not found; treating as deleted');
        return { status: 'done' };
      }
      throw err;
    }
  } catch (err: any) {
    logger.error('Detector IAM role deletion error', { errorName: err?.name, errorMessage: err?.message });
    return { status: 'failed', reason: `${err?.name}: ${err?.message}` };
  }
}

/**
 * Sweeps the stack-failure detector's rule, function and role as ONE removal — grouped
 * because `StackFailureDetectorRemoval` (the CDK registration) registers them as a single removal,
 * not three (see `features/sweeper/stack-failure-detector-removal.ts`). Sequential:
 * rule -> function -> role. Each step is independently idempotent (already-deleted -> done), so
 * re-invoking after a partial pass (e.g. a role DeleteConflictException) just re-verifies the
 * earlier steps are gone and resumes at whichever one didn't finish.
 */
export async function sweepStackFailureDetector(
  input: StackFailureDetectorRemovalInput,
  logger: LoggerBuffer,
  eventsClient: EventBridgeClient,
  lambdaClient: LambdaClient,
  iamClient: IAMClient,
): Promise<TargetResult> {
  const rule = await sweepRule(input, logger, eventsClient);
  if (rule.status !== 'done') return { target: 'detector', status: rule.status, reason: rule.reason };

  const fn = await sweepDetectorFn(input, logger, lambdaClient);
  if (fn.status !== 'done') return { target: 'detector', status: fn.status, reason: fn.reason };

  const role = await sweepDetectorRole(input, logger, iamClient);
  if (role.status !== 'done') return { target: 'detector', status: role.status, reason: role.reason };

  return { target: 'detector', status: 'done' };
}
