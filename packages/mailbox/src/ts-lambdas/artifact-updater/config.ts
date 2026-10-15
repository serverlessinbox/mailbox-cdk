import { env, loadBaseConfig, toRegion, type BaseConfig, type Region } from '@serverlessinbox/mailbox-cdk-shared/lambda-runtime';

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
    project: l.mandatory('PROJECT'),
    distTag: l.mandatory('DIST_TAG'),
    granularity: env.mandatoryAs(l, 'GRANULARITY', env.enumOf(...GRANULARITIES), 'major'),
    artifactBucketBase: l.mandatory('ARTIFACT_BUCKET_BASE'),
    rootStackTagValue: l.mandatory('ROOT_STACK_TAG_VALUE'),
  };
}
