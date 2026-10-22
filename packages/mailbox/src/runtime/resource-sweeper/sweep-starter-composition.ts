import { CloudFormationClient }                 from '@aws-sdk/client-cloudformation';
import { SFNClient }                            from '@aws-sdk/client-sfn';
import { ParentStackStatus, type LoggerBuffer } from '@serverlessinbox/mailbox-cdk-shared/lambda-runtime';

import type { StarterConfig }                   from './config';
import { SweepStarter }                         from './sweep-starter';
import { SweepTargetPlanner }                   from './sweep-target-planner';

/** The clients the starter calls AWS with. */
interface StarterClients {
  readonly stepFunctions:  SFNClient;
  readonly cloudFormation: CloudFormationClient;
}

/**
 * Builds the sweep starter and everything it works with: the AWS clients, built once per cold start in the
 * region of the starter config, and the planner and parent stack check around the invocation's logger.
 * It decides nothing about a request. Only a config that loaded may be given to it.
 */
export class SweepStarterComposition {
  private readonly config: StarterConfig;
  private clients: StarterClients | undefined;

  constructor(config: StarterConfig) {
    this.config = config;
  }

  /** The starter of one invocation, logging to `logger`. */
  public sweepStarter(logger: LoggerBuffer): SweepStarter {
    const clients = this.clientsOnce();
    return new SweepStarter(
      this.config,
      clients.stepFunctions,
      new ParentStackStatus(clients.cloudFormation, logger),
      new SweepTargetPlanner(),
      logger,
    );
  }

  private clientsOnce(): StarterClients {
    this.clients ??= this.buildClients();
    return this.clients;
  }

  private buildClients(): StarterClients {
    const region = this.config.region;
    return {
      stepFunctions:  new SFNClient({ region }),
      cloudFormation: new CloudFormationClient({ region }),
    };
  }
}
