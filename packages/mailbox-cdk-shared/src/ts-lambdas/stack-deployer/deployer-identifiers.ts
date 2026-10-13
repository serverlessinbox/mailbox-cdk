import * as t from 'typanion';
import { parseArn } from '../shared/arn';

/**
 * The identifiers and names the stack deployer passes between its units, each a string of its own kind so
 * that one kind cannot be passed where another is expected. The brand exists in the type only. Every kind has
 * exactly one factory, and the cast to the brand sits in that factory and nowhere else.
 */

type Branded<Kind extends string> = string & { readonly __brand: Kind };

/** The name of a CloudFormation stack, as it is given to the API calls. */
export type StackName = Branded<'StackName'>;

/** The ARN-form id CloudFormation assigns to a stack. */
export type StackId = Branded<'StackId'>;

/** Where the template of a stack is read from. */
export type TemplateUrl = Branded<'TemplateUrl'>;

/** An AWS region code. */
export type Region = Branded<'Region'>;

/** The ARN of the Step Functions state machine that deploys a stack. */
export type StateMachineArn = Branded<'StateMachineArn'>;

/** The ARN of one execution of the state machine. */
export type ExecutionArn = Branded<'ExecutionArn'>;

/** The name of one execution, unique within its state machine. */
export type ExecutionName = Branded<'ExecutionName'>;

/** The logical id of the custom resource in the template that declared it. */
export type LogicalResourceId = Branded<'LogicalResourceId'>;

/** The id CloudFormation gives to one custom-resource request; it stays the same when CloudFormation retries the request. */
export type RequestId = Branded<'RequestId'>;

/** The physical id a custom resource answers CloudFormation with. */
export type PhysicalResourceId = Branded<'PhysicalResourceId'>;

/** The pre-signed URL a custom-resource answer is PUT to. */
export type ResponseUrl = Branded<'ResponseUrl'>;

type AnyBrand = { readonly __brand: string };

type PlainValue<Value> = Value extends AnyBrand ? string : Value;

/** The same shape with every branded string as the plain string it is on the wire, for code that writes the payload without these brands. */
export type Unbranded<Shape> = { [Field in keyof Shape]: PlainValue<Shape[Field]> };

export function toStackName(raw: string): StackName {
  return raw as StackName;
}

export function toStackId(raw: string): StackId {
  return raw as StackId;
}

export function toTemplateUrl(raw: string): TemplateUrl {
  return raw as TemplateUrl;
}

export function toRegion(raw: string): Region {
  return raw as Region;
}

export function toExecutionName(raw: string): ExecutionName {
  return raw as ExecutionName;
}

export function toLogicalResourceId(raw: string): LogicalResourceId {
  return raw as LogicalResourceId;
}

export function toRequestId(raw: string): RequestId {
  return raw as RequestId;
}

export function toPhysicalResourceId(raw: string): PhysicalResourceId {
  return raw as PhysicalResourceId;
}

export function toResponseUrl(raw: string): ResponseUrl {
  return raw as ResponseUrl;
}

/** Throws when the string is not a Step Functions state machine ARN. */
export function toStateMachineArn(raw: string): StateMachineArn {
  requireStatesArn(raw, 'stateMachine');
  return raw as StateMachineArn;
}

/** Throws when the string is not a Step Functions execution ARN. */
export function toExecutionArn(raw: string): ExecutionArn {
  requireStatesArn(raw, 'execution');
  return raw as ExecutionArn;
}

function requireStatesArn(raw: string, resourceType: 'stateMachine' | 'execution'): void {
  const parsed = parseArn(raw);
  if (parsed.service !== 'states' || parsed.resourceType !== resourceType) {
    throw new Error(`Invalid ARN "${raw}": expected a Step Functions ${resourceType}`);
  }
}

// A payload value gets its brand from the kind's factory, like every other value; the factory of these kinds accepts any string.
function isBrandedString<Brand extends string>(toBrand: (raw: string) => Brand): t.StrictValidator<unknown, Brand> {
  return t.makeValidator<unknown, Brand>({
    test: (value, state): value is Brand => {
      if (!t.isString()(value, state)) {
        return false;
      }
      toBrand(value);
      return true;
    },
  });
}

export const isStackName = isBrandedString(toStackName);
export const isStackId = isBrandedString(toStackId);
export const isTemplateUrl = isBrandedString(toTemplateUrl);
export const isRegion = isBrandedString(toRegion);
export const isLogicalResourceId = isBrandedString(toLogicalResourceId);
export const isRequestId = isBrandedString(toRequestId);
export const isResponseUrl = isBrandedString(toResponseUrl);
