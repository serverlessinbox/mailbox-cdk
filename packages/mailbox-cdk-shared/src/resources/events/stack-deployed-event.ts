import { LambdaFunction } from 'aws-cdk-lib/aws-events-targets';
import { Rule }           from 'aws-cdk-lib/aws-events';
import type { IFunction } from 'aws-cdk-lib/aws-lambda';
import { Stack }          from 'aws-cdk-lib';
import type { Construct } from 'constructs';

/** Invokes `target` each time the stack that contains it reaches CREATE_COMPLETE or UPDATE_COMPLETE. */
export class StackDeployedEvent extends Rule {
  constructor(scope: Construct, id: string, target: IFunction) {
    super(scope, id, {
      eventPattern: {
        source: ['aws.cloudformation'],
        detailType: ['CloudFormation Stack Status Change'],
        detail: {
          'stack-id': [Stack.of(scope).stackId],
          'status-details': {
            status: ['CREATE_COMPLETE', 'UPDATE_COMPLETE'],
          },
        },
      },
      targets: [new LambdaFunction(target)],
    });
  }
}
