import { env } from '@serverlessinbox/mailbox-cdk-shared/lambda-runtime';
import { load } from '../config';

describe('artifact-updater config', () => {
  beforeEach(() => {
    delete process.env.LOG_LEVEL;
    delete process.env.SERVICE_NAME;
    delete process.env.AWS_REGION;
    delete process.env.PROJECT;
    delete process.env.DIST_TAG;
    delete process.env.GRANULARITY;
    delete process.env.ARTIFACT_BUCKET_BASE;
    delete process.env.ROOT_STACK_TAG_VALUE;
  });

  afterEach(() => {
    delete process.env.LOG_LEVEL;
    delete process.env.SERVICE_NAME;
    delete process.env.AWS_REGION;
    delete process.env.PROJECT;
    delete process.env.DIST_TAG;
    delete process.env.GRANULARITY;
    delete process.env.ARTIFACT_BUCKET_BASE;
    delete process.env.ROOT_STACK_TAG_VALUE;
  });

  it('loads all vars when set', () => {
    process.env.LOG_LEVEL = 'debug';
    process.env.SERVICE_NAME = 'artifact-updater-service';
    process.env.AWS_REGION = 'eu-west-1';
    process.env.PROJECT = 'serverlessinbox';
    process.env.DIST_TAG = 'latest';
    process.env.GRANULARITY = 'major';
    process.env.ARTIFACT_BUCKET_BASE = 'mailbox-artifacts';
    process.env.ROOT_STACK_TAG_VALUE = 'my-stack';

    const result = env.tryLoad(load);
    expect(result).toEqual({
      config: {
        logLevel: 'debug',
        serviceName: 'artifact-updater-service',
        region: 'eu-west-1',
        project: 'serverlessinbox',
        distTag: 'latest',
        granularity: 'major',
        artifactBucketBase: 'mailbox-artifacts',
        rootStackTagValue: 'my-stack',
      },
      error: undefined,
    });
  });

  it('reports error when mandatory vars missing', () => {
    const mandatoryVars = ['AWS_REGION', 'PROJECT', 'DIST_TAG', 'GRANULARITY', 'ARTIFACT_BUCKET_BASE', 'ROOT_STACK_TAG_VALUE'];

    for (const varName of mandatoryVars) {
      const result = env.tryLoad(load);
      expect(result.error).toContain(varName);
    }
  });

  it('uses defaults when all optionals absent', () => {
    process.env.AWS_REGION = 'eu-west-1';
    process.env.PROJECT = 'serverlessinbox';
    process.env.DIST_TAG = 'latest';
    process.env.GRANULARITY = 'major';
    process.env.ARTIFACT_BUCKET_BASE = 'mailbox-artifacts';
    process.env.ROOT_STACK_TAG_VALUE = 'my-stack';

    const result = env.tryLoad(load);
    expect(result).toEqual({
      config: {
        logLevel: 'error',
        serviceName: '',
        region: 'eu-west-1',
        project: 'serverlessinbox',
        distTag: 'latest',
        granularity: 'major',
        artifactBucketBase: 'mailbox-artifacts',
        rootStackTagValue: 'my-stack',
      },
      error: undefined,
    });
  });
});
