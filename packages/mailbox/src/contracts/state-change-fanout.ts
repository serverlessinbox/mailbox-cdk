import type { IGrantable } from 'aws-cdk-lib/aws-iam';

/** The capability to hand a state change to the state-change fan-out, without exposing the fan-out Lambda itself. */
export interface IStateChangeFanout {
  readonly functionName: string;
  grantInvoke(grantee: IGrantable): void;
}
