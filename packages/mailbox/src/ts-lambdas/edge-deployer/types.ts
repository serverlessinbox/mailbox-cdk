export interface MailboxEdgeDeployerProperties {
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

export type OperationInput = MailboxEdgeDeployerProperties & {
  requestType: 'Create' | 'Update' | 'Delete';
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
  ResourceProperties: MailboxEdgeDeployerProperties;
};
