import { Grant, IGrantable } from 'aws-cdk-lib/aws-iam';
import { ITable } from 'aws-cdk-lib/aws-dynamodb';

const READ = ['dynamodb:GetItem', 'dynamodb:BatchGetItem', 'dynamodb:Query'] as const;
const WRITE = ['dynamodb:PutItem', 'dynamodb:UpdateItem', 'dynamodb:DeleteItem'] as const;

/**
 * Explicit least-privilege DynamoDB action sets — `read`, `write`, and `readWrite` (their union) —
 * for use with `grantTableActions`. Kept separate from CDK's `Table.grantRead*`/`grantWrite*`/
 * `grantReadWriteData`: those also allow `Scan` and PartiQL (`ExecuteStatement` etc.), which no
 * caller in this repo uses.
 */
export const DynamoDbActions = {
  read: READ,
  write: WRITE,
  readWrite: [...READ, ...WRITE],
} as const;

/**
 * Grants a caller exactly the given DynamoDB actions on a table, scoped to the table's ARN and
 * `<tableArn>/index/*`. A caller can query a GSI but cannot `Scan` or run a PartiQL statement
 * unless one of those actions is explicitly included in `actions`.
 */
export function grantTableActions(grantee: IGrantable, table: ITable, actions: readonly string[]): Grant {
  return Grant.addToPrincipal({
    grantee,
    actions: [...actions],
    resourceArns: [table.tableArn, `${table.tableArn}/index/*`],
  });
}
