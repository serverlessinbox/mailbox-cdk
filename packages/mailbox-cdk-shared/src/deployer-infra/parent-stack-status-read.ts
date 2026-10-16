import { Aws } from 'aws-cdk-lib';
import { PolicyStatement } from 'aws-cdk-lib/aws-iam';

/**
 * The permission to read the status of the stack that contains the deployer, which is the parent of the custom
 * resources the deployer answers. It names that one stack by its id, rendered as a token so the template of a
 * stack deployed anywhere carries the id of the stack it is deployed as.
 */
export function parentStackStatusReadStatement(): PolicyStatement {
  return new PolicyStatement({
    actions: ['cloudformation:DescribeStacks'],
    resources: [Aws.STACK_ID],
  });
}
