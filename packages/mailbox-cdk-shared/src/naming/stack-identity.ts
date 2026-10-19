import { Aws, Fn } from 'aws-cdk-lib';

/**
 * The unique id of the stack being synthesized, as deploy-time CloudFormation tokens. Names that
 * must differ between two stacks in one account and region are built from it. It carries no
 * information about the stack's name or its construct tree.
 */
export class StackIdentity {
  /**
   * The guid at the end of the stack id ARN, `arn:aws:cloudformation:region:account:stack/stack-name/guid`.
   * Always 36 characters once resolved.
   */
  static get guid(): string {
    return Fn.select(2, Fn.split('/', Aws.STACK_ID));
  }

  /** The first hyphen-separated segment of the guid: 8 characters once resolved. */
  static get guidPrefix(): string {
    return Fn.select(0, Fn.split('-', StackIdentity.guid));
  }
}
