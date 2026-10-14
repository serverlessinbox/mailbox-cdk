import { env, loadBaseConfig, toRegion, type BaseConfig, type Region } from '@serverlessinbox/mailbox-cdk-shared/lambda-runtime';
import { ArtifactUpdaterEnvNames } from './env-names';

const GRANULARITIES = ['major', 'minor'] as const;

/** The granularity at which a deployed version selects the release track it follows. */
export type Granularity = (typeof GRANULARITIES)[number];

/** The environment the artifact-updater Lambda reads: the shared base plus where and what it updates. */
export interface Config extends BaseConfig {
  readonly region: Region;
  readonly functionName: string;
  readonly project: string;
  readonly distTag: string;
  readonly granularity: Granularity;
  readonly artifactBucketBase: string;
  readonly rootStackTagValue: string;
}

/** The settings that locate a release artifact, which every update path needs. */
export type UpdaterTargetConfig = Pick<Config, 'project' | 'distTag' | 'granularity' | 'artifactBucketBase'>;

export function load(l: env.Loader): Config {
  return {
    ...loadBaseConfig(l),
    region: toRegion(l.mandatory('AWS_REGION')),
    functionName: l.mandatory('AWS_LAMBDA_FUNCTION_NAME'),
    project: l.mandatory(ArtifactUpdaterEnvNames.project),
    distTag: l.mandatory(ArtifactUpdaterEnvNames.distTag),
    granularity: env.mandatoryAs(l, ArtifactUpdaterEnvNames.granularity, env.enumOf(...GRANULARITIES), 'major'),
    artifactBucketBase: l.mandatory(ArtifactUpdaterEnvNames.artifactBucketBase),
    rootStackTagValue: l.mandatory(ArtifactUpdaterEnvNames.rootStackTagValue),
  };
}
