import { ArtifactZone, PinnedArtifactResolver }      from '@serverlessinbox/artifact-registry-cdk';
import type { IArtifactResolver }                    from '@serverlessinbox/artifact-registry-cdk';
import { Template }                                  from 'aws-cdk-lib/assertions';
import { AttributeType, Table }                      from 'aws-cdk-lib/aws-dynamodb';
import { Code, Function as LambdaFunction, Runtime } from 'aws-cdk-lib/aws-lambda';
import { App, BootstraplessSynthesizer, Stack }      from 'aws-cdk-lib';

import { newAdminApiProps }                          from '../../core/apis/__tests__/apis-helpers';
import type { AdminApiAddonContext, IAdminApiAddon } from '../../core/apis/addons';
import { AdminApi }                                  from '../../core/apis/admin-api';
import type { IIdentityProvisioner }                 from '../../resources/lambdas/identity-provisioner-lambda';
import { AuditEventsQueue }                          from '../../resources/queues/audit-events-queue';
import { DataTable }                                 from '../../resources/tables/data-tables';

/** The account and region a test stack is synthesized in. */
export interface TestEnvironment {
  readonly account: string;
  readonly region:  string;
}

const DEFAULT_ENVIRONMENT: TestEnvironment = { account: '123456789012', region: 'us-west-2' };

/**
 * A stack with an explicit environment, so intrinsics that depend on the account or region render as
 * the deployed template would show them. `context` is the CDK app context the stack is created in.
 */
export function newTestStack(id: string, environment: TestEnvironment = DEFAULT_ENVIRONMENT, context?: Record<string, unknown>): Stack {
  return new Stack(new App({ context }), id, {
    env:         environment,
    synthesizer: new BootstraplessSynthesizer(),
  });
}

/** A resolver that pins every package the platform constructs take Lambda code from, all at one version, in the stack's region. */
export function newArtifactResolver(stack: Stack, version = '1.0.0'): IArtifactResolver {
  return new PinnedArtifactResolver({
    packages:         {
      'mailbox-go':         { version, zone: ArtifactZone.REGIONAL },
      'mailbox-cdk':        { version, zone: ArtifactZone.REGIONAL },
      'mailbox-cdk-shared': { version, zone: ArtifactZone.REGIONAL },
      'mailbox-cdk-edge':   { version, zone: ArtifactZone.EDGE },
    },
    location:         { bucketBase: 'test-artifacts', project: 'serverlessinbox' },
    deploymentRegion: stack.region,
  });
}

/** A data table with the partition and sort keys of the platform's data tables. */
export function newDataTable(stack: Stack, id: string): DataTable {
  return new DataTable(new Table(stack, id, {
    partitionKey: { name: 'pk', type: AttributeType.STRING },
    sortKey:      { name: 'sk', type: AttributeType.STRING },
  }));
}

/** A Lambda function with inline code, for a test that needs a function and nothing about its code. */
export function newInlineFunction(stack: Stack, id: string): LambdaFunction {
  return new LambdaFunction(stack, id, { runtime: Runtime.NODEJS_20_X, handler: 'index.handler', code: Code.fromInline('x') });
}

/** Mounts `addon` on a real `AdminApi` in `stack` and returns the synthesized template. */
export function synthesizeOnAdminApi(stack: Stack, addon: IAdminApiAddon): Template {
  new AdminApi(stack, 'admin-api', newAdminApiProps(stack, { addons: [addon] }));

  return Template.fromStack(stack);
}

/**
 * The shared resources an admin API addon is created from. Every resource is real except the identity
 * provisioner, which is a typed fake: its functions are `jest.fn`, so a test can check what was granted.
 */
export function newAdminApiAddonContext(stack: Stack): AdminApiAddonContext {
  const identityProvisioner: IIdentityProvisioner = {
    functionArn:  'arn:aws:lambda:us-west-2:123456789012:function:identity-provisioner',
    functionName: 'identity-provisioner',
    grantInvoke:  jest.fn(),
  };
  return {
    artifactResolver: newArtifactResolver(stack),
    auditEventsQueue: new AuditEventsQueue(stack, 'audit-events-queue'),
    auditLogTable:    newDataTable(stack, 'audit-log-table'),
    configTable:      newDataTable(stack, 'config-table'),
    identityProvisioner,
  };
}
