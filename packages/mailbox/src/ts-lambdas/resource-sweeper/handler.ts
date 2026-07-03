import { wrapHandler } from 'aws-custom-resources';
import {
  ACMClient,
  DescribeCertificateCommand,
  DeleteCertificateCommand,
  ListTagsForCertificateCommand,
} from '@aws-sdk/client-acm';
import {
  LambdaClient,
  GetFunctionCommand,
  DeleteFunctionCommand,
} from '@aws-sdk/client-lambda';
import { SFNClient, StartExecutionCommand } from '@aws-sdk/client-sfn';
import type { CloudFormationCustomResourceHandler } from 'aws-lambda';

const sfnClient = new SFNClient({ region: process.env.AWS_REGION });

/**
 * Worker handler input: targets to delete (optional; at least one should be present).
 */
export interface WorkerInput {
  certArn?: string;
  edgeFnArn?: string;
  rootStackName: string;
}

/**
 * Worker handler output: status of the sweep operation.
 * - SUCCESS: every provided target is confirmed gone.
 * - RETRY: at least one provided target still not deletable.
 * - FAILED: hard error or ownership mismatch.
 */
export interface WorkerOutput {
  status: 'SUCCESS' | 'RETRY' | 'FAILED';
  reason?: string;
}

/**
 * Worker handler: invoked by Step Functions to delete both ACM certs and Lambda@Edge functions.
 * Idempotent — each invocation re-checks and deletes whatever is still pending.
 *
 * INPUT: { certArn?: string, edgeFnArn?: string, rootStackName: string }
 * OUTPUT: { status: 'SUCCESS' | 'RETRY' | 'FAILED', reason?: string }
 *
 * - If certArn present: DescribeCertificate → check InUseBy. If empty, DeleteCertificate.
 *   ResourceNotFoundException → already done. Ownership mismatch → FAILED. InUseBy non-empty → RETRY.
 * - If edgeFnArn present: GetFunction in us-east-1 → verify tag. DeleteFunction.
 *   ResourceNotFoundException → already done. Ownership mismatch → FAILED. Other error → RETRY.
 * - Aggregate: FAILED if any hard error/mismatch; RETRY if any target not-done; SUCCESS if all done.
 */
export const workerHandler = async (input: WorkerInput): Promise<WorkerOutput> => {
  console.log('Worker invoked', {
    hasCertArn: !!input.certArn,
    hasEdgeFnArn: !!input.edgeFnArn,
    rootStackName: input.rootStackName,
  });

  const results: { target: string; status: 'done' | 'retry' | 'failed'; reason?: string }[] = [];

  // Process ACM cert if provided
  if (input.certArn) {
    try {
      const acmClient = new ACMClient({ region: process.env.AWS_REGION });
      const certArn = input.certArn;

      // Verify ownership via tags
      console.log('Verifying ACM cert ownership', { certArn });
      try {
        const tagsResp = await acmClient.send(
          new ListTagsForCertificateCommand({ CertificateArn: certArn })
        );
        const tags = tagsResp.Tags ?? [];
        const ownerTag = tags.find((t) => t.Key === 'serverless-inbox:root-stack');
        if (ownerTag?.Value !== input.rootStackName) {
          console.warn('ACM cert ownership mismatch', {
            certArn,
            expectedStack: input.rootStackName,
            actualStack: ownerTag?.Value,
          });
          results.push({
            target: 'cert',
            status: 'failed',
            reason: `Ownership mismatch (expected ${input.rootStackName}, got ${ownerTag?.Value})`,
          });
        } else {
          // Ownership verified; check if cert is still in use
          console.log('ACM cert ownership verified; checking InUseBy', { certArn });
          const descResp = await acmClient.send(
            new DescribeCertificateCommand({ CertificateArn: certArn })
          );
          const inUseBy = descResp.Certificate?.InUseBy ?? [];
          if (inUseBy.length > 0) {
            console.log('ACM cert still in use; will retry', { certArn, inUseBy });
            results.push({ target: 'cert', status: 'retry', reason: `InUseBy: ${inUseBy.join(', ')}` });
          } else {
            // Ready to delete
            console.log('ACM cert not in use; attempting delete', { certArn });
            await acmClient.send(new DeleteCertificateCommand({ CertificateArn: certArn }));
            console.log('ACM cert deleted successfully', { certArn });
            results.push({ target: 'cert', status: 'done' });
          }
        }
      } catch (err: any) {
        if (err.name === 'ResourceNotFoundException') {
          console.log('ACM cert not found; treating as deleted', { certArn });
          results.push({ target: 'cert', status: 'done' });
        } else {
          throw err;
        }
      }
    } catch (err: any) {
      console.warn('ACM cert deletion error', {
        certArn: input.certArn,
        errorName: err?.name,
        errorMessage: err?.message,
      });
      results.push({
        target: 'cert',
        status: 'failed',
        reason: `${err?.name}: ${err?.message}`,
      });
    }
  }

  // Process Lambda@Edge function if provided
  if (input.edgeFnArn) {
    try {
      const lambdaClient = new LambdaClient({ region: 'us-east-1' });
      const edgeFnArn = input.edgeFnArn;

      // Extract function name from ARN (last segment)
      // Format: arn:aws:lambda:us-east-1:ACCOUNT:function:FUNCTION-NAME
      const functionName = edgeFnArn.split(':').pop()!;

      try {
        // Verify ownership via tags
        console.log('Verifying Lambda function ownership', { functionName });
        const getResp = await lambdaClient.send(
          new GetFunctionCommand({ FunctionName: functionName })
        );
        const tags = getResp.Tags ?? {};
        const ownerStack = tags['serverless-inbox:root-stack'];
        if (ownerStack !== input.rootStackName) {
          console.warn('Lambda function ownership mismatch', {
            functionName,
            expectedStack: input.rootStackName,
            actualStack: ownerStack,
          });
          results.push({
            target: 'edge-fn',
            status: 'failed',
            reason: `Ownership mismatch (expected ${input.rootStackName}, got ${ownerStack})`,
          });
        } else {
          // Ownership verified; proceed to delete
          console.log('Lambda function ownership verified; attempting delete', { functionName });
          await lambdaClient.send(new DeleteFunctionCommand({ FunctionName: functionName }));
          console.log('Lambda function deleted successfully', { functionName });
          results.push({ target: 'edge-fn', status: 'done' });
        }
      } catch (err: any) {
        if (err.name === 'ResourceNotFoundException') {
          console.log('Lambda function not found; treating as deleted', { functionName });
          results.push({ target: 'edge-fn', status: 'done' });
        } else {
          throw err;
        }
      }
    } catch (err: any) {
      // Replicas draining or other transient error → RETRY
      console.warn('Lambda function deletion error (will retry)', {
        edgeFnArn: input.edgeFnArn,
        errorName: err?.name,
        errorMessage: err?.message,
      });
      results.push({
        target: 'edge-fn',
        status: 'retry',
        reason: `${err?.name}: ${err?.message}`,
      });
    }
  }

  // Aggregate results
  console.log('Worker results', { results });

  // Check for failures
  const failures = results.filter((r) => r.status === 'failed');
  if (failures.length > 0) {
    return {
      status: 'FAILED',
      reason: failures.map((f) => `${f.target}: ${f.reason}`).join('; '),
    };
  }

  // Check for retries
  const retries = results.filter((r) => r.status === 'retry');
  if (retries.length > 0) {
    return {
      status: 'RETRY',
      reason: retries.map((r) => `${r.target}: ${r.reason}`).join('; '),
    };
  }

  // All done
  return { status: 'SUCCESS' };
};

/**
 * Starter handler: fires a Step Functions execution to sweep deferred resources.
 * Called by CloudFormation custom resource (DeferredRemoval) on Delete (or Update-with-change).
 *
 * Wrapped with wrapHandler to guarantee CloudFormation response always sent;
 * sweep runs asynchronously. StartExecution failures are logged but do not
 * prevent the custom resource from completing (best-effort).
 */
export const starterHandler: CloudFormationCustomResourceHandler = wrapHandler(async (event) => {
  console.log('Starter invoked', {
    requestType: event.RequestType,
    requestId: event.RequestId,
    logicalResourceId: event.LogicalResourceId,
  });

  const certArn = event.ResourceProperties['CertArn'] as string | undefined;
  const edgeFnArn = event.ResourceProperties['EdgeFnArn'] as string | undefined;
  const rootStackName = process.env['MAILBOX_SWEEPER_ROOT_STACK_NAME']!;
  const smArn = process.env['MAILBOX_SWEEPER_STATE_MACHINE_ARN']!;

  // Determine which ARNs to sweep
  // wrapHandler's event type doesn't expose OldResourceProperties, but it's present in Update events
  const cfnEvent = event as any;

  const oldCertArn = cfnEvent.OldResourceProperties?.['CertArn'] as string | undefined;
  const oldEdgeFnArn = cfnEvent.OldResourceProperties?.['EdgeFnArn'] as string | undefined;

  const isReplaced =
    event.RequestType === 'Update' &&
    (oldCertArn !== certArn || oldEdgeFnArn !== edgeFnArn);

  const arnsToSweep: { certArn?: string; edgeFnArn?: string } = {};

  // On Delete, sweep current ARNs
  // On Update with change, sweep old ARNs
  if (event.RequestType === 'Delete') {
    if (certArn) arnsToSweep.certArn = certArn;
    if (edgeFnArn) arnsToSweep.edgeFnArn = edgeFnArn;
  } else if (isReplaced) {
    if (oldCertArn) arnsToSweep.certArn = oldCertArn;
    if (oldEdgeFnArn) arnsToSweep.edgeFnArn = oldEdgeFnArn;
  }

  console.log('Determining sweep targets', {
    requestType: event.RequestType,
    certArn,
    edgeFnArn,
    oldCertArn,
    oldEdgeFnArn,
    isReplaced,
    arnsToSweep,
  });

  // Physical resource ID: stable identifier
  const physicalResourceId = [certArn, edgeFnArn].filter(Boolean).join('|') || event.RequestId;

  // Fire the execution if there's something to sweep (at least one ARN).
  // Failures are logged but do NOT throw; wrapHandler guarantees a response.
  if (arnsToSweep.certArn || arnsToSweep.edgeFnArn) {
    try {
      const executionInput = {
        certArn: arnsToSweep.certArn,
        edgeFnArn: arnsToSweep.edgeFnArn,
        rootStackName,
      };

      console.log('Starting SFN execution', { executionName: event.RequestId, stateMachineArn: smArn });

      await sfnClient.send(
        new StartExecutionCommand({
          stateMachineArn: smArn,
          name: event.RequestId,
          input: JSON.stringify(executionInput),
        })
      );

      console.log('SFN execution started successfully');
    } catch (err: any) {
      // ExecutionAlreadyExists means the execution is already running (likely a retry)
      if (err.name === 'ExecutionAlreadyExists') {
        console.log('Execution already exists (likely a retry); treating as success');
      } else {
        // Any other error: log but do NOT throw. Delete must always succeed so
        // CloudFormation never hangs waiting for a response.
        console.warn('Failed to start SFN execution (best-effort, will not propagate):', {
          errorName: err?.name,
          errorMessage: err?.message,
        });
      }
    }
  } else {
    console.log('No sweep targets; skipping execution start (Create or Update with unchanged ARNs)');
  }

  // Return response object. wrapHandler will always send this to CloudFormation,
  // even if the function threw an uncaught error (which we don't have here).
  return {
    PhysicalResourceId: physicalResourceId,
    Data: {},
  };
});
