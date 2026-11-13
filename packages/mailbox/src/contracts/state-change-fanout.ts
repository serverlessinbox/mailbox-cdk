import type { IGrantable } from 'aws-cdk-lib/aws-iam';
import type { IFunction }  from 'aws-cdk-lib/aws-lambda';

/** The capability to hand a state change to the state-change fan-out, without exposing the fan-out Lambda itself. */
export interface IStateChangeFanout {
  readonly functionName: string;
  grantInvoke(grantee: IGrantable): void;
}

/** A Lambda that hands state changes to the state-change fan-out; it is pointed at the fan-out by its own enable method. */
export interface IStateChangeSource extends IFunction {
  enableStateChangeFanout(stateChangeFanout: IStateChangeFanout): void;
}
