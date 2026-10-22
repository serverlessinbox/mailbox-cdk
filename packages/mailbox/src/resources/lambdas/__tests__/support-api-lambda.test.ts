/// <reference types="jest" />

/**
 * Pins what `SupportApiLambda` passes to the Go handler and which grants it takes: the support role
 * ARNs and tier tag keys the handler reads by name, and the grants on the roles, the config table,
 * the audit queue and the vendor API. A renamed variable or a dropped grant breaks case handling at
 * runtime, where nothing in the template reports it.
 */

import { ArtifactZone, PinnedArtifactResolver }           from '@serverlessinbox/artifact-registry-cdk';
import type { ArtifactPin }                               from '@serverlessinbox/artifact-registry-cdk';
import { actionsOf }                                      from '@serverlessinbox/mailbox-cdk-shared/cdk-test-support';
import { Template }                                       from 'aws-cdk-lib/assertions';
import { Table, AttributeType }                           from 'aws-cdk-lib/aws-dynamodb';
import { App, BootstraplessSynthesizer, Stack }           from 'aws-cdk-lib';

import { SupportRolesInfra }                              from '../../../platform/support/support-roles-infra';
import { AuditEventsQueue }                               from '../../queues/audit-events-queue';
import { DataTable }                                      from '../../tables/data-tables';
import { SupportApiLambda }                               from '../support-api-lambda';

import { onlyLambdaOf }                                   from './lambda-wrapper-helpers';
import type { SynthesizedLambda }                         from './lambda-wrapper-helpers';

const VENDOR_ACCOUNT = '999988887777';

interface SynthesizedSupportApi extends SynthesizedLambda {
  readonly stack: Stack;
  readonly roles: SupportRolesInfra;
}

/** A token as the template renders it, as plain JSON. */
function templateValue(stack: Stack, value: string): unknown {
  return JSON.parse(JSON.stringify(stack.resolve(value))) as unknown;
}

function synthesize(): SynthesizedSupportApi {
  const stack = new Stack(new App(), 'TestStack', {
    env:         { account: '123456789012', region: 'us-west-2' },
    synthesizer: new BootstraplessSynthesizer(),
  });

  const packages: Record<string, ArtifactPin> = {
    'mailbox-go': { version: '1.0.0', zone: ArtifactZone.REGIONAL },
  };
  const artifactResolver                      = new PinnedArtifactResolver({
    packages,
    location:         { bucketBase: 'test-artifacts', project: 'serverlessinbox' },
    deploymentRegion: stack.region,
  });

  const roles = new SupportRolesInfra(stack, 'roles', { vendorAccountIds: [VENDOR_ACCOUNT] });
  new SupportApiLambda(stack, 'support-api', {
    supportRoles:     roles,
    configTable:      new DataTable(new Table(stack, 'config-table', { partitionKey: { name: 'pk', type: AttributeType.STRING } })),
    auditEventsQueue: new AuditEventsQueue(stack, 'audit-events-queue'),
    artifactResolver,
    vendorAccountIds: [VENDOR_ACCOUNT],
  });

  return { stack, roles, ...onlyLambdaOf(Template.fromStack(stack)) };
}

describe('SupportApiLambda', () => {
  const { stack, roles, environment, statements } = synthesize();
  const actions                                   = statements.flatMap((statement) => actionsOf(statement));

  it('passes the support role ARNs and tier tag keys to the handler by name', () => {
    expect(environment).toMatchObject({
      SUPPORT_HOP_ROLE_ARN:         templateValue(stack, roles.hopRoleArn),
      SUPPORT_DIAG_ROLE_ARN:        templateValue(stack, roles.diagRoleArn),
      SUPPORT_CONFIG_READ_ROLE_ARN: templateValue(stack, roles.configReadRoleArn),
      SUPPORT_DIAG_TAG_KEY:         'serverless-inbox:support:diag',
      SUPPORT_CONFIG_READ_TAG_KEY:  'serverless-inbox:support:config-read',
    });
  });

  it('passes the config table, audit queue and stack id to the handler by name', () => {
    expect(Object.keys(environment)).toEqual(expect.arrayContaining(['CONFIG_TABLE_NAME', 'AUDIT_EVENTS_QUEUE_URL', 'STACK_ID']));
  });

  it('takes the tag grants on the hop role, the CloudTrail lookup, the table, the queue and the vendor API', () => {
    expect(actions).toEqual(expect.arrayContaining([
      'iam:TagRole',
      'iam:UntagRole',
      'cloudtrail:LookupEvents',
      'dynamodb:PutItem',
      'sqs:SendMessage',
      'execute-api:Invoke',
    ]));
  });

  it('may call the case sync route of every vendor account', () => {
    const invoke = statements.find((statement) => actionsOf(statement).includes('execute-api:Invoke'));

    expect(invoke?.Resource).toBe(`arn:aws:execute-api:*:${VENDOR_ACCOUNT}:*/*/POST/support-case-sync`);
  });
});
