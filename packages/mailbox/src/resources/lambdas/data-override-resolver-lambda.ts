import type { IArtifactResolver }   from '@serverlessinbox/artifact-registry-cdk';
import { TypeScriptLambda }         from '@serverlessinbox/mailbox-cdk-shared';
import * as iam                     from 'aws-cdk-lib/aws-iam';
import * as cdk                     from 'aws-cdk-lib';
import { Construct }                from 'constructs';

import { MAILBOX_ARTIFACT_PACKAGE } from '../../contracts/mailbox-artifact-package';

/**
 * The artifact resolver the resolver's code is loaded from. It carries no table ARNs; each custom
 * resource event supplies those.
 */
export interface DataOverrideResolverLambdaProps {
  readonly artifactResolver: IArtifactResolver;
}

/**
 * Custom-resource Lambda that, for each data table role, takes the incoming table ARN and the
 * operator-overridable parameter's current value and decides whether to honor the override.
 */
export class DataOverrideResolverLambda extends TypeScriptLambda {
  constructor(scope: Construct, id: string, props: DataOverrideResolverLambdaProps) {
    super(scope, id, {
      lambdaId:         'data-override-resolver',
      packageName:      MAILBOX_ARTIFACT_PACKAGE,
      pipeline:         'infra',
      artifactResolver: props.artifactResolver,
      timeout:          cdk.Duration.seconds(60),
      memorySize:       256,
    });

    this.grantDescribeAnyTable();
  }

  private grantDescribeAnyTable(): void {
    // DescribeTable on any table: the override target is operator-chosen, so it cannot be name-scoped to this stack.
    this.addToRolePolicy(
      new iam.PolicyStatement({
        actions:   ['dynamodb:DescribeTable'],
        resources: [`arn:${cdk.Aws.PARTITION}:dynamodb:${cdk.Aws.REGION}:${cdk.Aws.ACCOUNT_ID}:table/*`],
      })
    );
  }
}
