import * as t                    from 'typanion';

import {
  isLogicalResourceId,
  isPhysicalResourceId,
  isRequestId,
  isResponseUrl,
  isStackId,
  isStackName,
  type PhysicalResourceId,
  type StackName,
} from '../../runtime/handler-kit/custom-resource/custom-resource-identifiers';
import { isRegion, type Region } from '../shared/aws-identifiers';
import type { Unbranded }        from '../shared/branded';

import { isTemplateUrl }         from './deployer-identifiers';
import { isStackFlag }           from './stack-flag';

const isRequestType = t.isEnum(['Create', 'Update', 'Delete'] as const);

/** The kind of CloudFormation request a custom resource answers. */
export type RequestType = t.InferType<typeof isRequestType>;

const isStringMap = t.isRecord(t.isOptional(t.isString()));

const stackDeployerPropertyFields = {
  ServiceToken: t.isOptional(t.isString()),
  stackName: isStackName,
  /** Absent only when the stack is being deleted; a create or update without one is rejected before any CloudFormation call. */
  templateUrl: t.isOptional(isTemplateUrl),
  /** CloudFormation stack parameters; an undefined or empty value is not passed on. */
  parameters: t.isOptional(isStringMap),
  /** Tags applied to the AWS::CloudFormation::Stack itself and propagated by CloudFormation to its resources. */
  tags: t.isOptional(isStringMap),
  terminationProtection: t.isOptional(isStackFlag),
  /** Region of the CloudFormation API calls; the Lambda's own region when absent. */
  region: t.isOptional(isRegion),
  /** When on, a Delete skips DeleteStack and is answered SUCCESS, leaving the stack and its retained resources. */
  preserveOnDelete: t.isOptional(isStackFlag),
};

// The resources set properties beside the ones listed here (`ServiceTimeout` in the template, `ServiceToken`),
// so a key that is not listed is accepted and kept.
export const isStackDeployerProperties = t.isPartial(stackDeployerPropertyFields);

/**
 * The properties a Delete needs; it proceeds on these alone when the others are not valid. A preserveOnDelete
 * that is not a switch is among them: a Delete that cannot tell whether to keep the stack does not delete it.
 */
export const isDeletionProperties = t.isPartial({
  stackName: isStackName,
  region: t.isOptional(isRegion),
  preserveOnDelete: t.isOptional(isStackFlag),
});

/** The properties of the custom resource that deploys one CloudFormation stack, with the identifiers as the Lambda reads them. */
export type BrandedStackDeployerProperties = t.InferType<typeof isStackDeployerProperties>;

/** The properties of the custom resource that deploys one CloudFormation stack, as the construct writes them: plain strings. */
export type StackDeployerProperties = Unbranded<BrandedStackDeployerProperties>;

// The starter copies the properties of the resource into the operation as they came, so the operation accepts
// the keys the properties accept.
const isOperationInput = t.isPartial({ ...stackDeployerPropertyFields, requestType: isRequestType });

/** One stack operation: the custom resource's properties plus the kind of request that asked for it. */
export type OperationInput = t.InferType<typeof isOperationInput>;

const cfnTargetFields = {
  ResponseURL: isResponseUrl,
  StackId: isStackId,
  RequestId: isRequestId,
  LogicalResourceId: isLogicalResourceId,
  ResourceType: t.isOptional(t.isString()),
};

/** Where to PUT an answer and which resource it concerns; the physical id is read apart from it. */
export const isCfnTarget = t.isPartial(cfnTargetFields);

/** The physical id CloudFormation sent with a request; every Update and Delete carries one, a Create none. */
const physicalIdField = { PhysicalResourceId: t.isOptional(isPhysicalResourceId) };

const cfnEnvelopeFields = { ...cfnTargetFields, ...physicalIdField };

export const isCfnEnvelope = t.isPartial(cfnEnvelopeFields);

/** What the worker needs to answer CloudFormation for a request: where to PUT and which resource it concerns. */
export type CfnEnvelope = t.InferType<typeof isCfnEnvelope>;

// The request is a CloudFormation document, so only the fields read are listed. The properties are checked
// separately, once the request is known to be answerable.
export const isCfnRequest = t.isPartial({
  ...cfnEnvelopeFields,
  RequestType: isRequestType,
  ResourceProperties: t.isPartial({ stackName: t.isOptional(isStackName) }),
});

/** A CloudFormation custom-resource request, as far as it must be known to answer it. */
export type CfnRequest = t.InferType<typeof isCfnRequest>;

// Each field an answer can use is read on its own, so one that is wrong does not hide the others.
export const isRequestTypeOfRequest = t.isPartial({ RequestType: isRequestType });
export const isStackNameOfRequest = t.isPartial({ ResourceProperties: t.isPartial({ stackName: isStackName }) });
export const isPhysicalIdOfRequest = t.isPartial({ PhysicalResourceId: isPhysicalResourceId });
export const isTargetOfStep = t.isPartial({ cfn: isCfnTarget });
export const isPhysicalIdOfStep = t.isPartial({ cfn: t.isPartial({ PhysicalResourceId: isPhysicalResourceId }) });
export const isRequestTypeOfStep = t.isPartial({ op: t.isPartial({ requestType: isRequestType }) });
export const isStackNameOfStep = t.isPartial({ op: t.isPartial({ stackName: isStackName }) });
export const isRegionOfRequest = t.isPartial({ ResourceProperties: t.isPartial({ region: isRegion }) });
export const isRegionOfStep = t.isPartial({ op: t.isPartial({ region: isRegion }) });

/**
 * What an event that could not be read in full still gives to answer it: where to PUT, and the physical id,
 * request type, stack name and region of the stack when they are readable. An event without a response
 * target cannot be answered.
 */
export interface AnswerableEvent {
  readonly cfn: CfnEnvelope;
  readonly physicalResourceId: PhysicalResourceId | undefined;
  readonly requestType: RequestType | undefined;
  readonly stackName: StackName | undefined;
  readonly region?: Region | undefined;
}

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
