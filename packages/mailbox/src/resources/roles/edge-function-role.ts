import * as iam                    from 'aws-cdk-lib/aws-iam';
import { Aws }                     from 'aws-cdk-lib';
import type { Construct }          from 'constructs';

import type { IAuthKeyStoreTable } from '../tables/auth-key-store-table';

/** Inputs of `EdgeFunctionRole`: the one table it reads and the name pattern of the edge stack whose function it runs. */
export interface EdgeFunctionRoleProps {
  /** Auth key store the function reads with `GetItem`; no other table is granted. */
  readonly authKeyStoreTable: IAuthKeyStoreTable;

  /** Name pattern of the edge stack (`<root stack>-edge-*`); the function name is generated from it. */
  readonly edgeStackNamePattern: string;
}

/**
 * Lambda@Edge execution role of the jmap-blob-download function. Replicas keep running for about four
 * hours after the function is deleted, but on cached credentials, so they do not need the role to outlive
 * the stack. On a replacement CloudFormation creates the new role before deleting the old one, and updates
 * the edge function with the new ARN in the same operation.
 *
 * Owns its grants: `GetItem` on the auth key store and log writes to the function's replica log groups.
 */
export class EdgeFunctionRole extends iam.Role {
  constructor(scope: Construct, id: string, props: EdgeFunctionRoleProps) {
    super(scope, id, {
      assumedBy:   new iam.CompositePrincipal(
        new iam.ServicePrincipal('lambda.amazonaws.com'),
        new iam.ServicePrincipal('edgelambda.amazonaws.com'),
      ),
      description: `Serverless Inbox Mailbox: jmap-blob-download Lambda@Edge role (${Aws.STACK_NAME})`,
    });

    this.grantAuthKeyStoreGetItem(props.authKeyStoreTable);
    this.grantReplicaLogs(props.edgeStackNamePattern);
  }

  private grantAuthKeyStoreGetItem(authKeyStoreTable: IAuthKeyStoreTable): void {
    authKeyStoreTable.grantGetItem(this);
  }

  /**
   * Replicas write to `/aws/lambda/us-east-1.<function name>` in the region each one runs in, and create that
   * group there when it is missing. The function name is generated from the edge stack name, so the patterns
   * name that prefix in every region of this account.
   */
  private grantReplicaLogs(edgeStackNamePattern: string): void {
    const replicaLogGroupArn = `arn:${Aws.PARTITION}:logs:*:${Aws.ACCOUNT_ID}:log-group:/aws/lambda/us-east-1.${edgeStackNamePattern}`;

    this.addToPrincipalPolicy(new iam.PolicyStatement({
      actions:   ['logs:CreateLogGroup'],
      resources: [replicaLogGroupArn],
    }));
    this.addToPrincipalPolicy(new iam.PolicyStatement({
      actions:   ['logs:CreateLogStream', 'logs:PutLogEvents'],
      resources: [`${replicaLogGroupArn}:*`],
    }));
  }
}
