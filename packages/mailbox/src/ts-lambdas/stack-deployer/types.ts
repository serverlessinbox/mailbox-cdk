export interface StackDeployerProperties {
  stackName: string;
  templateUrl: string;
  /** CloudFormation stack parameters for the edge stack */
  parameters?: Record<string, string | undefined>;
  /** Whether to enable termination protection on the edge stack */
  terminationProtection?: boolean;
}

export type CfnEnvelope = {
  ResponseURL: string;
  StackId: string;
  RequestId: string;
  LogicalResourceId: string;
  ResourceType?: string;
};

export type OperationInput = StackDeployerProperties & {
  requestType: 'Create' | 'Update' | 'Delete';
  /** Target region for CloudFormation API calls. Defaults to AWS_REGION when absent. Edge deployer passes 'us-east-1'. */
  region?: string;
  /** When true, Delete handler skips DeleteStack and returns SUCCESS immediately. Used by data deployer to preserve retained resources. */
  preserveOnDelete?: boolean;
};

export type SfnInvokeEvent = {
  mode: 'start' | 'check';
  cfn: CfnEnvelope;
  op: OperationInput;
  /** Polling iteration counter injected by the Step Functions workflow. */
  attempt?: number;
  /** Number of DeleteStack retries triggered by Lambda@Edge replica-drain failures. */
  deleteRetryCount?: number;
};

export type CfnCustomResourceEvent = {
  RequestType: 'Create' | 'Update' | 'Delete';
  ResponseURL: string;
  StackId: string;
  RequestId: string;
  LogicalResourceId: string;
  ResourceType?: string;
  ResourceProperties: StackDeployerProperties;
};
