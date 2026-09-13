import { env } from '@serverlessinbox/mailbox-cdk-shared/lambda-runtime';
import { load } from '../config';

describe('artifact-updater config', () => {
  beforeEach(() => {
    delete process.env.LOG_LEVEL;
    delete process.env.SERVICE_NAME;
    delete process.env.PROJECT;
    delete process.env.DIST_TAG;
    delete process.env.GRANULARITY;
    delete process.env.ARTIFACT_BUCKET_BASE;
    delete process.env.ROOT_STACK_TAG_VALUE;
    delete process.env.LOCK_TABLE_NAME;
  });

  afterEach(() => {
    delete process.env.LOG_LEVEL;
    delete process.env.SERVICE_NAME;
    delete process.env.PROJECT;
    delete process.env.DIST_TAG;
    delete process.env.GRANULARITY;
    delete process.env.ARTIFACT_BUCKET_BASE;
    delete process.env.ROOT_STACK_TAG_VALUE;
    delete process.env.LOCK_TABLE_NAME;
  });

  it('loads all vars when set', () => {
    process.env.LOG_LEVEL = 'debug';
    process.env.SERVICE_NAME = 'artifact-updater-service';
    process.env.PROJECT = 'serverlessinbox';
    process.env.DIST_TAG = 'latest';
    process.env.GRANULARITY = 'major';
    process.env.ARTIFACT_BUCKET_BASE = 'mailbox-artifacts';
    process.env.ROOT_STACK_TAG_VALUE = 'my-stack';
    process.env.LOCK_TABLE_NAME = 'artifact-updater-lock';

    const result = env.tryLoad(load);
    expect(result).toEqual({
      config: {
        logLevel: 'debug',
        serviceName: 'artifact-updater-service',
        project: 'serverlessinbox',
        distTag: 'latest',
        granularity: 'major',
        artifactBucketBase: 'mailbox-artifacts',
        rootStackTagValue: 'my-stack',
        lockTableName: 'artifact-updater-lock',
      },
      error: undefined,
    });
  });

  it('reports error when mandatory vars missing', () => {
    const mandatoryVars = ['PROJECT', 'DIST_TAG', 'GRANULARITY', 'ARTIFACT_BUCKET_BASE', 'ROOT_STACK_TAG_VALUE', 'LOCK_TABLE_NAME'];

    for (const varName of mandatoryVars) {
      const result = env.tryLoad(load);
      expect(result.error).toContain(varName);
    }
  });

  it('uses defaults when all optionals absent', () => {
    process.env.PROJECT = 'serverlessinbox';
    process.env.DIST_TAG = 'latest';
    process.env.GRANULARITY = 'major';
    process.env.ARTIFACT_BUCKET_BASE = 'mailbox-artifacts';
    process.env.ROOT_STACK_TAG_VALUE = 'my-stack';
    process.env.LOCK_TABLE_NAME = 'artifact-updater-lock';

    const result = env.tryLoad(load);
    expect(result).toEqual({
      config: {
        logLevel: 'error',
        serviceName: '',
        project: 'serverlessinbox',
        distTag: 'latest',
        granularity: 'major',
        artifactBucketBase: 'mailbox-artifacts',
        rootStackTagValue: 'my-stack',
        lockTableName: 'artifact-updater-lock',
      },
      error: undefined,
    });
  });
});
