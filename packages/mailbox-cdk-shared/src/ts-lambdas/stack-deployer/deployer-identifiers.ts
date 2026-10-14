import { parseArn } from '../shared/arn';
import { isBrandedString, type Branded } from '../shared/branded';

/**
 * The identifiers and names only the stack deployer passes between its units, each a string of its own kind so
 * that one kind cannot be passed where another is expected. The brand exists in the type only. Every kind has
 * exactly one factory, and the cast to the brand sits in that factory and nowhere else.
 */

/** Where the template of a stack is read from. */
export type TemplateUrl = Branded<'TemplateUrl'>;

/** The ARN of the Step Functions state machine that deploys a stack. */
export type StateMachineArn = Branded<'StateMachineArn'>;

/** The ARN of one execution of the state machine. */
export type ExecutionArn = Branded<'ExecutionArn'>;

/** The name of one execution, unique within its state machine. */
export type ExecutionName = Branded<'ExecutionName'>;

export function toTemplateUrl(raw: string): TemplateUrl {
  return raw as TemplateUrl;
}

export function toExecutionName(raw: string): ExecutionName {
  return raw as ExecutionName;
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

export const isTemplateUrl = isBrandedString(toTemplateUrl);
