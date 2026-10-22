/// <reference types="jest" />

/**
 * Pins the variables the artifact-updater configuration adds to the shared base: each is mandatory and named
 * in the error when missing, and the granularity must be one the release tracks understand. The base's own
 * variables are pinned in the suite of the shared base configuration.
 */

import { env }  from '@serverlessinbox/mailbox-cdk-shared/lambda-runtime';

import { load } from '../config';

const ENVIRONMENT = {
  SERVICE_NAME:             'artifact-updater',
  AWS_REGION:               'eu-west-1',
  AWS_LAMBDA_FUNCTION_NAME: 'artifact-updater-function',
  PROJECT:                  'serverlessinbox',
  DIST_TAG:                 'latest',
  GRANULARITY:              'major',
  ARTIFACT_BUCKET_BASE:     'mailbox-artifacts',
  ROOT_STACK_TAG_VALUE:     'my-stack',
  ROOT_STACK_ID:            'guid-1',
};

describe('artifact-updater config', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv, ...ENVIRONMENT };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('loads the variables it adds to the base', () => {
    const result = env.tryLoad(load);

    expect(result.error).toBeUndefined();
    expect(result.config).toMatchObject({
      region:             'eu-west-1',
      functionName:       'artifact-updater-function',
      project:            'serverlessinbox',
      distTag:            'latest',
      granularity:        'major',
      artifactBucketBase: 'mailbox-artifacts',
      rootStackTagValue:  'my-stack',
      rootStackId:        'guid-1',
    });
  });

  it.each([
    'AWS_REGION',
    'AWS_LAMBDA_FUNCTION_NAME',
    'PROJECT',
    'DIST_TAG',
    'GRANULARITY',
    'ARTIFACT_BUCKET_BASE',
    'ROOT_STACK_TAG_VALUE',
    'ROOT_STACK_ID',
  ])('reports %s as missing when it is the only variable not set', (variable) => {
    delete process.env[variable];

    const result = env.tryLoad(load);

    expect(result.error).toBe(`${variable} is not set`);
  });

  it('accepts the minor granularity', () => {
    process.env.GRANULARITY = 'minor';

    expect(env.tryLoad(load).config.granularity).toBe('minor');
  });

  it('rejects a granularity that is not major or minor, naming the variable and the value', () => {
    process.env.GRANULARITY = 'patch';

    const result = env.tryLoad(load);

    expect(result.error).toContain('GRANULARITY');
    expect(result.error).toContain('"patch"');
  });
});
