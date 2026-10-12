import { env, parseLogLevelStrict, type LogLevel } from '@serverlessinbox/mailbox-cdk-shared/lambda-runtime';

export interface Config {
  readonly logLevel: LogLevel;
  readonly serviceName: string;
  readonly region: string;
  readonly project: string;
  readonly distTag: string;
  readonly granularity: string;
  readonly artifactBucketBase: string;
  readonly rootStackTagValue: string;
}

export function load(l: env.Loader): Config {
  return {
    logLevel: env.optionalAs(l, 'LOG_LEVEL', 'error', parseLogLevelStrict),
    serviceName: l.mandatory('SERVICE_NAME'),
    region: l.mandatory('AWS_REGION'),
    project: l.mandatory('PROJECT'),
    distTag: l.mandatory('DIST_TAG'),
    granularity: l.mandatory('GRANULARITY'),
    artifactBucketBase: l.mandatory('ARTIFACT_BUCKET_BASE'),
    rootStackTagValue: l.mandatory('ROOT_STACK_TAG_VALUE'),
  };
}
