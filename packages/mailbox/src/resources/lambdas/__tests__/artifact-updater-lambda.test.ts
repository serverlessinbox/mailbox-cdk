/// <reference types="jest" />

/**
 * ArtifactUpdaterLambda: the environment it provisions, its sizing and the grants on its role.
 *
 * The updater runs with no stack-level role of its own beyond these statements, so a broadened
 * resource, a dropped tag condition or a loosened `aws:TagKeys` constraint lets it change resources
 * outside its root stack or rewrite the tag that scopes it. The environment is the contract with
 * the runtime configuration: a variable the template stops setting makes every invocation answer
 * with a configuration failure.
 */

import { ArtifactZone, PinnedArtifactResolver }                             from '@serverlessinbox/artifact-registry-cdk';
import type { ArtifactPin }                                                 from '@serverlessinbox/artifact-registry-cdk';
import { getAttLogicalId, statementsForRole }                               from '@serverlessinbox/mailbox-cdk-shared/cdk-test-support';
import type { PolicyStatementJson }                                         from '@serverlessinbox/mailbox-cdk-shared/cdk-test-support';
import { env }                                                              from '@serverlessinbox/mailbox-cdk-shared/lambda-runtime';
import { ServerlessInboxTagKeys }                                           from '@serverlessinbox/mailbox-cdk-shared';
import { Template }                                                         from 'aws-cdk-lib/assertions';
import { App, BootstraplessSynthesizer, CfnCondition, Duration, Fn, Stack } from 'aws-cdk-lib';

import { load }                                                             from '../../../runtime/artifact-updater/config';
import { ArtifactUpdaterLambda }                                            from '../artifact-updater-lambda';

const TRACKING_CONDITION       = 'IsTracking';
const ROOT_STACK               = 'my-root-stack';
const BUCKET_BASE              = 'test-artifacts';
const ROOT_STACK_ID            = 'guid-1';
const ROOT_STACK_TAG_KEY       = `aws:ResourceTag/${ServerlessInboxTagKeys.rootStack}`;
const ROOT_STACK_ID_TAG_KEY    = `aws:ResourceTag/${ServerlessInboxTagKeys.rootStackId}`;
const OWNED_BY_ID              = { StringEquals: { [ROOT_STACK_ID_TAG_KEY]: ROOT_STACK_ID } };
const OWNED_BY_NAME_WITHOUT_ID = { StringEquals: { [ROOT_STACK_TAG_KEY]: ROOT_STACK }, Null: { [ROOT_STACK_ID_TAG_KEY]: 'true' } };
const ARTIFACT_VERSION_ONLY    = { 'ForAllValues:StringEquals': { 'aws:TagKeys': [ServerlessInboxTagKeys.artifactVersion] } };

function accountArn(prefix: string, suffix: string): unknown {
  return { 'Fn::Join': ['', [prefix, { Ref: 'AWS::AccountId' }, suffix]] };
}

interface FunctionResource {
  readonly Properties: {
    readonly Timeout:     number;
    readonly MemorySize:  number;
    readonly Role:        unknown;
    readonly Environment: { readonly Variables: Record<string, unknown> };
  };
}

describe('ArtifactUpdaterLambda', () => {
  let template: Template;
  let updater: FunctionResource;
  let updaterLogicalId: string;
  let roleStatements: PolicyStatementJson[];
  let roleLogicalId: string;

  beforeAll(() => {
    const stack                                 = new Stack(new App(), 'TestStack', {
      env:         { account: '123456789012', region: 'us-west-2' },
      synthesizer: new BootstraplessSynthesizer(),
    });
    const packages: Record<string, ArtifactPin> = { 'mailbox-cdk': { version: '1.0.0', zone: ArtifactZone.REGIONAL } };
    new ArtifactUpdaterLambda(stack, 'artifact-updater', {
      artifactResolver:   new PinnedArtifactResolver({
        packages,
        location:         { bucketBase: BUCKET_BASE, project: 'serverlessinbox' },
        deploymentRegion: stack.region,
      }),
      distTag:            'stable',
      granularity:        'minor',
      rootStackTagValue:  ROOT_STACK,
      rootStackId:        ROOT_STACK_ID,
      artifactBucketBase: BUCKET_BASE,
      updateInterval:     Duration.hours(3),
      isTracking:         new CfnCondition(stack, TRACKING_CONDITION, { expression: Fn.conditionEquals('a', 'a') }),
    });

    template           =Template.fromStack(stack);
    const functions    = template.findResources('AWS::Lambda::Function');
    [updaterLogicalId] = Object.keys(functions);
    updater            = functions[updaterLogicalId] as FunctionResource;
    roleLogicalId      = getAttLogicalId(updater.Properties.Role) ?? '';
    roleStatements     = statementsForRole(template, roleLogicalId);
  });

  describe('function', () => {
    it('runs for at most five minutes with 256 MB', () => {
      expect(updater.Properties.Timeout).toBe(Duration.minutes(5).toSeconds());
      expect(updater.Properties.MemorySize).toBe(256);
    });

    it('sets the variables its configuration reads from the template', () => {
      expect(updater.Properties.Environment.Variables).toMatchObject({
        ARTIFACT_BUCKET_BASE: BUCKET_BASE,
        DIST_TAG:             'stable',
        GRANULARITY:          'minor',
        PROJECT:              'serverlessinbox',
        ROOT_STACK_TAG_VALUE: ROOT_STACK,
        ROOT_STACK_ID,
      });
    });

    it('provides an environment its runtime configuration loads without error', () => {
      const originalEnv             = process.env;
      const injectedByLambdaRuntime = { AWS_REGION: 'us-west-2', AWS_LAMBDA_FUNCTION_NAME: 'artifact-updater-function' };
      process.env                   = { ...originalEnv, ...stringValues(updater.Properties.Environment.Variables), ...injectedByLambdaRuntime };

      try {
        expect(env.tryLoad(load).error).toBeUndefined();
      } finally {
        process.env = originalEnv;
      }
    });

    it('grants the role to invoke the function itself', () => {
      template.hasResourceProperties('AWS::Lambda::Permission', {
        Action:       'lambda:InvokeFunction',
        FunctionName: { 'Fn::GetAtt': [updaterLogicalId, 'Arn'] },
        Principal:    { 'Fn::GetAtt': [roleLogicalId, 'Arn'] },
      });
    });
  });

  describe('update schedule', () => {
    it('gates the rule on the tracking condition', () => {
      const rules = Object.values(template.findResources('AWS::Events::Rule'));

      expect(rules).toHaveLength(1);
      expect(rules[0].Condition).toBe(TRACKING_CONDITION);
    });

    it('gates the permission that lets the rule invoke the function on the tracking condition', () => {
      const permissions = Object.values(template.findResources('AWS::Lambda::Permission', { Properties: { Principal: 'events.amazonaws.com' } }));

      expect(permissions).toHaveLength(1);
      expect(permissions[0].Condition).toBe(TRACKING_CONDITION);
    });

    it('invokes this function at the given interval', () => {
      template.hasResourceProperties('AWS::Events::Rule', {
        ScheduleExpression: 'rate(3 hours)',
        Targets:            [{ Arn: { 'Fn::GetAtt': [updaterLogicalId, 'Arn'] }, Id: 'Target0' }],
      });
    });
  });

  describe('role statements', () => {
    /** A statement owned by the root stack: one statement for a resource tagged with its id, one for a resource without an id tag. */
    function ownedStatements(
      name: string,
      statement: { Action: string | string[]; Effect: 'Allow'; Resource: unknown },
      extraCondition = {},
    ): Array<[string, PolicyStatementJson]> {
      return [
        [`${name} by id`, { ...statement, Condition: { ...OWNED_BY_ID, ...extraCondition } }],
        [`${name} by name when the resource has no id tag`, { ...statement, Condition: { ...OWNED_BY_NAME_WITHOUT_ID, ...extraCondition } }],
      ];
    }

    const expectedStatements: Array<[string, PolicyStatementJson]> = [
      ['tag discovery, unscoped', { Action: 'tag:GetResources', Effect: 'Allow', Resource: '*' }],
      ...ownedStatements('function management in the root stack', {
        Action:   ['lambda:GetFunction', 'lambda:GetFunctionConfiguration', 'lambda:UpdateFunctionCode', 'lambda:InvokeFunction'],
        Effect:   'Allow',
        Resource: accountArn('arn:aws:lambda:*:', ':function:*'),
      }),
      ...ownedStatements(
        'function tagging limited to the artifact-version key',
        { Action: 'lambda:TagResource', Effect: 'Allow', Resource: accountArn('arn:aws:lambda:*:', ':function:*') },
        ARTIFACT_VERSION_ONLY,
      ),
      ...ownedStatements('edge function publishing in us-east-1', {
        Action:   ['lambda:GetFunctionConfiguration', 'lambda:PublishVersion'],
        Effect:   'Allow',
        Resource: accountArn('arn:aws:lambda:us-east-1:', ':function:*'),
      }),
      ...ownedStatements('distribution management in the root stack', {
        Action:   ['cloudfront:GetDistributionConfig', 'cloudfront:UpdateDistribution', 'cloudfront:CreateInvalidation'],
        Effect:   'Allow',
        Resource: accountArn('arn:aws:cloudfront::', ':distribution/*'),
      }),
      ...ownedStatements(
        'distribution tagging limited to the artifact-version key',
        { Action: 'cloudfront:TagResource', Effect: 'Allow', Resource: accountArn('arn:aws:cloudfront::', ':distribution/*') },
        ARTIFACT_VERSION_ONLY,
      ),
      [
        'release artifact download from the registry buckets',
        {
          Action:   's3:GetObject',
          Effect:   'Allow',
          Resource: `arn:aws:s3:::${BUCKET_BASE}-*/serverlessinbox/packages/*/releases/*`,
        },
      ],
      [
        'status reads of the stack the function belongs to',
        { Action: 'cloudformation:DescribeStacks', Effect: 'Allow', Resource: { Ref: 'AWS::StackId' } },
      ],
    ];

    it.each(expectedStatements)('grants %s', (_name, statement) => {
      expect(roleStatements).toContainEqual(statement);
    });

    it('grants the statements in a stable order', () => {
      expect(roleStatements.map((statement) => statement.Action)).toEqual(expectedStatements.map(([, statement]) => statement.Action));
    });
  });
});

function stringValues(variables: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(variables).map(([name, value]) => {
      if (typeof value !== 'string') {
        throw new Error(`Environment variable ${name} is not a plain string in the template: ${JSON.stringify(value)}`);
      }
      return [name, value];
    }),
  );
}
