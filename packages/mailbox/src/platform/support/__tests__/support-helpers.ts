import type { IArtifactResolver }                          from '@serverlessinbox/artifact-registry-cdk';
import type { Template }                                   from 'aws-cdk-lib/assertions';
import type { Stack }                                      from 'aws-cdk-lib';

import type { AdminApiAddonContext }                       from '../../../core/apis/addons';
import type { IIdentityProvisioner }                       from '../../../resources/lambdas/identity-provisioner-lambda';
import { AuditEventsQueue }                                from '../../../resources/queues/audit-events-queue';
import type { DataTable }                                  from '../../../resources/tables/data-tables';
import { newArtifactResolver, newDataTable, newTestStack } from '../../__tests__/platform-helpers';

/** A resource of a synthesized template, as `Template.findResources` returns it. */
export type SynthesizedResource = ReturnType<Template['findResources']>[string];

/** The shared inputs a support addon is built from, on a stack with an explicit environment. */
export interface SupportTestStack {
  readonly stack:            Stack;
  readonly configTable:      DataTable;
  readonly auditEventsQueue: AuditEventsQueue;
  readonly artifactResolver: IArtifactResolver;
}

/**
 * Creates the stack, config table, audit queue and artifact resolver that the support addon
 * is built from. `context` is the CDK app context, used to override the vendor account IDs.
 */
export function createSupportTestStack(context?: Record<string, unknown>): SupportTestStack {
  const stack = newTestStack('test-stack', { account: '111122223333', region: 'us-east-1' }, context);
  return {
    stack,
    configTable:      newDataTable(stack, 'config-table'),
    auditEventsQueue: new AuditEventsQueue(stack, 'audit-queue'),
    artifactResolver: newArtifactResolver(stack, '1.0.0'),
  };
}

/** The identity provisioner is required by the addon context but never invoked by the support addon. */
const unusedIdentityProvisioner: IIdentityProvisioner = {
  functionArn:  'arn:aws:lambda:us-east-1:111122223333:function:identity-provisioner',
  functionName: 'identity-provisioner',
  grantInvoke:  () => {},
};

export function createAddonContext(inputs: SupportTestStack): AdminApiAddonContext {
  return {
    configTable:         inputs.configTable,
    auditEventsQueue:    inputs.auditEventsQueue,
    auditLogTable:       newDataTable(inputs.stack, 'audit-log-table'),
    identityProvisioner: unusedIdentityProvisioner,
    artifactResolver:    inputs.artifactResolver,
  };
}

/** A synthesized Lambda function, found by the `SERVICE_NAME` its environment carries. */
export interface SynthesizedFunction {
  readonly logicalId:     string;
  readonly environment:   Record<string, unknown>;
  readonly roleLogicalId: string;
  readonly code:          string | undefined;
}

/** The parts of a synthesized `AWS::Lambda::Function` that `findFunction` reads. */
interface SynthesizedFunctionResource {
  readonly Properties: {
    readonly Role:         { readonly 'Fn::GetAtt': [string, string] };
    readonly Code:         { readonly S3Key?: string };
    readonly Environment?: { readonly Variables: Record<string, unknown> };
  };
}

export function findFunction(template: Template, serviceName: string): SynthesizedFunction {
  // cast: CDK's findResources returns untyped template JSON; this is the one framework boundary.
  const functions = Object.entries(template.findResources('AWS::Lambda::Function')) as Array<[string, SynthesizedFunctionResource]>;
  const matches   = functions.filter(([, functionResource]) => functionResource.Properties.Environment?.Variables.SERVICE_NAME === serviceName);
  if (matches.length !== 1) {
    throw new Error(`expected one Lambda with SERVICE_NAME ${serviceName}, found ${matches.length}`);
  }
  const [[logicalId, functionResource]] = matches;
  return {
    logicalId,
    environment:   functionResource.Properties.Environment?.Variables ?? {},
    roleLogicalId: functionResource.Properties.Role['Fn::GetAtt'][0],
    code:          functionResource.Properties.Code.S3Key,
  };
}
