import * as t from 'typanion';

const isRequestType = t.isEnum(['Create', 'Update', 'Delete'] as const);

/** The kind of CloudFormation request a custom resource answers. */
export type RequestType = t.InferType<typeof isRequestType>;

const isStringMap = t.isRecord(t.isOptional(t.isString()));

// Property values may arrive as strings, so a flag is read in either form and keeps the value it arrived with.
const isFlag = t.isOneOf([t.isBoolean(), t.isString()]);
const isTerminationProtection = t.isOneOf([t.isBoolean(), t.isEnum(['true', 'false'] as const)]);

const stackDeployerPropertyFields = {
  ServiceToken: t.isOptional(t.isString()),
  stackName: t.isString(),
  /** Absent only when the stack is being deleted; a create or update without one is refused by CloudFormation. */
  templateUrl: t.isOptional(t.isString()),
  /** CloudFormation stack parameters; an undefined or empty value is not passed on. */
  parameters: t.isOptional(isStringMap),
  /** Tags applied to the AWS::CloudFormation::Stack itself and propagated by CloudFormation to its resources. */
  tags: t.isOptional(isStringMap),
  terminationProtection: t.isOptional(isTerminationProtection),
  /** Region of the CloudFormation API calls; the Lambda's own region when absent. */
  region: t.isOptional(t.isString()),
  /** When set, a Delete skips DeleteStack and is answered SUCCESS, leaving the stack and its retained resources. Any non-empty string, `'false'` included, counts as set. */
  preserveOnDelete: t.isOptional(isFlag),
};

// The resources set properties beside the ones listed here (`ServiceTimeout` in the template, `ServiceToken`),
// so a key that is not listed is accepted and kept.
export const isStackDeployerProperties = t.isPartial(stackDeployerPropertyFields);

/** The properties a Delete needs; it proceeds on these alone when the others are not valid. */
export const isDeletionProperties = t.isPartial({
  stackName: t.isString(),
  region: t.isOptional(t.isString()),
  preserveOnDelete: t.isOptional(isFlag),
});

/** The properties of the custom resource that deploys one CloudFormation stack. */
export type StackDeployerProperties = t.InferType<typeof isStackDeployerProperties>;

// The starter copies the properties of the resource into the operation as they came, so the operation accepts
// the keys the properties accept.
const isOperationInput = t.isPartial({ ...stackDeployerPropertyFields, requestType: isRequestType });

/** One stack operation: the custom resource's properties plus the kind of request that asked for it. */
export type OperationInput = t.InferType<typeof isOperationInput>;

const cfnEnvelopeFields = {
  ResponseURL: t.isString(),
  StackId: t.isString(),
  RequestId: t.isString(),
  LogicalResourceId: t.isString(),
  ResourceType: t.isOptional(t.isString()),
};

const isCfnEnvelope = t.isPartial(cfnEnvelopeFields);

/** What the worker needs to answer CloudFormation for a request: where to PUT and which resource it concerns. */
export type CfnEnvelope = t.InferType<typeof isCfnEnvelope>;

// The request is a CloudFormation document, so only the fields read are listed. The properties are checked
// separately, once the request is known to be answerable.
export const isCfnRequest = t.isPartial({
  ...cfnEnvelopeFields,
  RequestType: isRequestType,
  ResourceProperties: t.isPartial({ stackName: t.isOptional(t.isString()) }),
});

/** A CloudFormation custom-resource request, as far as it must be known to answer it. */
export type CfnRequest = t.InferType<typeof isCfnRequest>;

/** The input of the state machine execution that deploys one stack: how to answer CloudFormation and what to do. */
export interface WorkflowInput {
  readonly cfn: CfnEnvelope;
  readonly op: OperationInput;
}

// The workflow definition builds this payload, so a key it adds later must not stop the worker.
export const isSfnInvokeEvent = t.isPartial({
  mode: t.isEnum(['start', 'check'] as const),
  cfn: isCfnEnvelope,
  op: isOperationInput,
  /** Polling iteration counter injected by the Step Functions workflow. */
  attempt: t.isOptional(t.isNumber()),
  /** Number of DeleteStack retries triggered by Lambda@Edge replica-drain failures. */
  deleteRetryCount: t.isOptional(t.isNumber()),
  /** Number of CreateStack retries triggered by transient KMS key-availability failures. */
  createRetryCount: t.isOptional(t.isNumber()),
});

/** The input of one worker invocation in the Step Functions workflow that deploys a stack. */
export type SfnInvokeEvent = t.InferType<typeof isSfnInvokeEvent>;
