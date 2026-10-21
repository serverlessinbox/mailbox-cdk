import { CloudFormationClient } from '@aws-sdk/client-cloudformation';

export type { CloudFormationClient };

/** Builds a CloudFormation client for a Lambda whose package does not depend on the AWS SDK's CloudFormation client itself. */
export function createCloudFormationClient(): CloudFormationClient {
  return new CloudFormationClient({});
}
