import { ACMClient }                                      from '@aws-sdk/client-acm';
import { EventBridgeClient }                              from '@aws-sdk/client-eventbridge';
import { IAMClient }                                      from '@aws-sdk/client-iam';
import { LambdaClient }                                   from '@aws-sdk/client-lambda';
import { toRegion, type LoggerBuffer }                    from '@serverlessinbox/mailbox-cdk-shared/lambda-runtime';

import type { WorkerConfig }                              from './config';
import { RootStackMembership }                            from './root-stack-membership';
import { SweepWorker }                                    from './sweep-worker';
import { CertSweeper }                                    from './targets/cert-sweeper';
import { EdgeFunctionSweeper }                            from './targets/edge-function-sweeper';
import { StackFailureDetectorSweeper }                    from './targets/stack-failure-detector-sweeper';

/** Lambda@Edge functions live in this region only, wherever the stack runs. */
const LAMBDA_AT_EDGE_REGION = toRegion('us-east-1');

/** The clients the worker's sweepers call AWS with, each in the region its resources live in. */
interface WorkerClients {
  readonly acm:          ACMClient;
  readonly lambda:       LambdaClient;
  readonly lambdaAtEdge: LambdaClient;
  readonly eventBridge:  EventBridgeClient;
  readonly iam:          IAMClient;
}

/**
 * Builds the sweep worker and everything it works with: the AWS clients, built once per cold start in the
 * regions of the worker config, and the sweepers and root stack check around the invocation's logger.
 * It decides nothing about a payload. Only a config that loaded may be given to it.
 */
export class SweepWorkerComposition {
  private readonly config: WorkerConfig;
  private clients: WorkerClients | undefined;

  constructor(config: WorkerConfig) {
    this.config = config;
  }

  /** The worker of one invocation, logging to `logger`. */
  public sweepWorker(logger: LoggerBuffer): SweepWorker {
    const clients             = this.clientsOnce();
    const rootStackMembership = new RootStackMembership(logger);
    return new SweepWorker(
      logger,
      new CertSweeper(clients.acm, rootStackMembership, logger),
      new EdgeFunctionSweeper(clients.lambdaAtEdge, rootStackMembership, logger),
      new StackFailureDetectorSweeper(clients.eventBridge, clients.lambda, clients.iam, rootStackMembership, logger),
    );
  }

  private clientsOnce(): WorkerClients {
    this.clients ??= this.buildClients();
    return this.clients;
  }

  private buildClients(): WorkerClients {
    const region = this.config.region;
    return {
      acm:          new ACMClient({ region }),
      lambda:       new LambdaClient({ region }),
      lambdaAtEdge: new LambdaClient({ region: LAMBDA_AT_EDGE_REGION }),
      eventBridge:  new EventBridgeClient({ region }),
      iam:          new IAMClient({ region }),
    };
  }
}
