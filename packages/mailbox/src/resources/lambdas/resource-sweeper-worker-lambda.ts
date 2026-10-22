import type { IArtifactResolver } from '@serverlessinbox/artifact-registry-cdk';
import { TypeScriptLambda }       from '@serverlessinbox/mailbox-cdk-shared';
import * as iam                   from 'aws-cdk-lib/aws-iam';
import { Aws, Duration }          from 'aws-cdk-lib';
import { Construct }              from 'constructs';

export interface ResourceSweeperWorkerLambdaProps {
  artifactResolver: IArtifactResolver;

  /** IAM role for the worker Lambda */
  role: iam.IRole;
}

/**
 * Resource Sweeper Worker Lambda wrapper.
 * Deletes the resources of one removal target per invocation and reports whether the target is gone.
 */
export class ResourceSweeperWorkerLambda extends TypeScriptLambda {
  constructor(scope: Construct, id: string, props: ResourceSweeperWorkerLambdaProps) {
    super(scope, id, {
      lambdaId:         'resource-sweeper',
      pipeline:         'infra',
      serviceName:      'resource-sweeper-worker',
      artifactResolver: props.artifactResolver,
      packageName:      'mailbox-cdk',
      handler:          'index.workerHandler',
      timeout:          Duration.minutes(3),
      memorySize:       256,
      role:             props.role,
    });
  }

  /**
   * Adds the log grants to a policy the caller attaches to the worker's role. The role exists before
   * this function does and its log group name is generated, so the grants cannot name the group.
   */
  public grantLogWriting(policy: iam.Policy): void {
    policy.addStatements(this.grantLogGroupCreation(), this.grantLogStreamWriting());
  }

  private grantLogGroupCreation(): iam.PolicyStatement {
    return new iam.PolicyStatement({
      actions:   ['logs:CreateLogGroup'],
      resources: [`arn:aws:logs:${Aws.REGION}:${Aws.ACCOUNT_ID}:*`],
    });
  }

  /** Write-only, with the same effective scope as AWSLambdaBasicExecutionRole. */
  private grantLogStreamWriting(): iam.PolicyStatement {
    return new iam.PolicyStatement({
      actions:   ['logs:CreateLogStream', 'logs:PutLogEvents'],
      resources: [
        `arn:aws:logs:${Aws.REGION}:${Aws.ACCOUNT_ID}:log-group:*`,
        `arn:aws:logs:${Aws.REGION}:${Aws.ACCOUNT_ID}:log-group:*:*`,
      ],
    });
  }
}
