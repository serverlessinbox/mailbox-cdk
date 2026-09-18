import * as cdk from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import { TypeScriptLambda } from '@serverlessinbox/mailbox-cdk-shared';
import type { ICdkArtifactEngine } from '@serverlessinbox/mailbox-cdk-shared';
import { Construct } from 'constructs';

export interface DataOverrideResolverLambdaProps {
  readonly artifactResolver: ICdkArtifactEngine;
}

/**
 * Custom-resource handler for MailboxDataOverrideResolver: given a table role's incoming ARN and
 * the operator-overridable SSM parameter's current value, decides whether to honor an override.
 */
export class DataOverrideResolverLambda extends TypeScriptLambda {
  constructor(scope: Construct, id: string, props: DataOverrideResolverLambdaProps) {
    super(scope, id, {
      lambdaId: 'data-override-resolver',
      pipeline: 'infra',
      artifactResolver: props.artifactResolver,
      timeout: cdk.Duration.seconds(60),
      memorySize: 256,
    });

    this.grantDescribeAnyTable();
  }

  private grantDescribeAnyTable(): void {
    // DescribeTable on any table: the override target is operator-chosen, so it cannot be name-scoped to this stack.
    this.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['dynamodb:DescribeTable'],
        resources: [
          cdk.Stack.of(this).formatArn({
            service: 'dynamodb',
            resource: 'table',
            resourceName: '*',
          }),
        ],
      })
    );
  }
}
