import type { JsonObject } from './json-value';

/** The synthesized CloudFormation template of one stack the product deploys. */
export interface StackTemplate {
  /** The baseline name of the stack; it names the template's file inside a baseline folder. */
  readonly stackName: string;
  readonly template: JsonObject;
}
