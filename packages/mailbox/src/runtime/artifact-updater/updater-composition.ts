import { CloudFormationClient }                                                     from '@aws-sdk/client-cloudformation';
import { CloudFrontClient }                                                         from '@aws-sdk/client-cloudfront';
import { LambdaClient }                                                             from '@aws-sdk/client-lambda';
import { ResourceGroupsTaggingAPIClient }                                           from '@aws-sdk/client-resource-groups-tagging-api';
import { S3Client }                                                                 from '@aws-sdk/client-s3';
import { env, LoggerBuffer, type Region }                                           from '@serverlessinbox/mailbox-cdk-shared/lambda-runtime';
import type { CloudFormationCustomResourceEvent, Context }                          from 'aws-lambda';
import { setTimeout as sleep }                                                      from 'node:timers/promises';

import { CfnTrigger }                                                               from './cfn-trigger';
import { load }                                                                     from './config';
import { EdgeLambdaUpdater }                                                        from './edge-lambda-updater';
import { FunctionSmokeTester }                                                      from './function-smoke-tester';
import { HttpTrigger }                                                              from './http-trigger';
import { LambdaCodeRollback }                                                       from './lambda-code-rollback';
import { LambdaCodeUpdater }                                                        from './lambda-code-updater';
import { LambdaFunctionCode }                                                       from './lambda-function-code';
import { ReleaseArtifacts }                                                         from './release-artifacts';
import { ScheduledTrigger }                                                         from './scheduled-trigger';
import type { TriggerBuilder }                                                      from './trigger-detector';
import { UiBucketUpdater }                                                          from './ui-bucket-updater';
import { UpdateCycle }                                                              from './update-cycle';
import { EDGE_REGION, type RegionClients, RootStackResources, type UpdaterClients } from './updater-clients';
import type { HttpTriggerEvent }                                                    from './updater-event';
import type { ReadyUpdater, UpdaterRuntime }                                        from './updater-runtime';

/**
 * Builds what one invocation works with, from the runtime the entry point loaded once per cold start: the
 * invocation's logger and the triggers, each handed only the cycle factory, client, names and logger it uses.
 * It also loads that runtime. It decides nothing about an event. The cycle and the client exist only for a
 * configuration that loaded; for one that failed, asking for them throws the configuration error.
 */
export class UpdaterComposition implements TriggerBuilder {
  public readonly logger: LoggerBuffer;
  private readonly runtime: UpdaterRuntime;

  constructor(runtime: UpdaterRuntime) {
    this.runtime = runtime;
    this.logger  = new LoggerBuffer(runtime.config.serviceName, runtime.config.logLevel);
  }

  /** Loads the configuration and, when it loaded, builds the clients; a configuration that failed has no clients. */
  public static loadRuntime(): UpdaterRuntime {
    const { config, error } = env.tryLoad(load);
    // The Lambda runtime sets the region, so the client exists even when the configuration failed to load.
    const cloudFormation = new CloudFormationClient({});
    if (error !== undefined) {
      return { config, cloudFormation, clients: undefined, error };
    }
    return { config, cloudFormation, clients: UpdaterComposition.buildUpdaterClients(config.region), error: undefined };
  }

  public cfnTrigger(event: CloudFormationCustomResourceEvent, context: Context): CfnTrigger {
    return new CfnTrigger(
      event,
      context,
      () => this.updateCycle(),
      this.runtime.cloudFormation,
      this.runtime.error,
      this.runtime.config.serviceName,
    );
  }

  public httpTrigger(event: HttpTriggerEvent): HttpTrigger {
    return new HttpTrigger(
      event,
      () => this.deploymentLambda(),
      this.runtime.config.functionName,
      this.logger,
      this.runtime.error,
    );
  }

  public scheduledTrigger(): ScheduledTrigger {
    return new ScheduledTrigger(() => this.updateCycle());
  }

  private updateCycle(): UpdateCycle {
    const { config, clients } = this.ready();
    const releases            = new ReleaseArtifacts(clients.registryS3, config, this.logger);
    const functionCode        = new LambdaFunctionCode(sleep);
    const smokeTester         = new FunctionSmokeTester(this.logger);
    const rollback            = new LambdaCodeRollback(functionCode, this.logger);
    const rootStackResources  = new RootStackResources(config.rootStackTagValue, config.rootStackId);
    return new UpdateCycle(
      config,
      clients,
      rootStackResources,
      this.logger,
      new LambdaCodeUpdater(releases, functionCode, smokeTester, rollback, this.logger),
      new EdgeLambdaUpdater(
        clients.edge,
        clients.cloudFront,
        rootStackResources,
        releases,
        functionCode,
        smokeTester,
        rollback,
        this.logger,
        sleep,
      ),
      new UiBucketUpdater(clients.registryS3, clients.deployment, clients.cloudFront, releases, this.logger),
    );
  }

  private deploymentLambda(): LambdaClient {
    return this.ready().clients.deployment.lambda;
  }

  private ready(): ReadyUpdater {
    if (this.runtime.error !== undefined) {
      throw new Error(this.runtime.error);
    }
    return this.runtime;
  }

  private static buildUpdaterClients(deploymentRegion: Region): UpdaterClients {
    const deployment = UpdaterComposition.buildRegionClients(deploymentRegion);
    return {
      // Artifact and pointer buckets are per-region, so reads follow S3 region redirects.
      registryS3: new S3Client({ region: deploymentRegion, followRegionRedirects: true }),
      deployment,
      edge: deploymentRegion === EDGE_REGION ? deployment : UpdaterComposition.buildRegionClients(EDGE_REGION),
      cloudFront: new CloudFrontClient({ region: EDGE_REGION }),
    };
  }

  private static buildRegionClients(region: Region): RegionClients {
    return {
      region,
      lambda: new LambdaClient({ region }),
      tagging: new ResourceGroupsTaggingAPIClient({ region }),
    };
  }
}
