import { ArtifactZone, PinnedArtifactResolver }         from '@serverlessinbox/artifact-registry-cdk';
import type { IArtifactResolver }                       from '@serverlessinbox/artifact-registry-cdk';
import type { Template }                                from 'aws-cdk-lib/assertions';
import { HttpLambdaAuthorizer, HttpLambdaResponseType } from 'aws-cdk-lib/aws-apigatewayv2-authorizers';
import { HttpApi }                                      from 'aws-cdk-lib/aws-apigatewayv2';
import { Table, AttributeType }                         from 'aws-cdk-lib/aws-dynamodb';
import * as lambda                                      from 'aws-cdk-lib/aws-lambda';
import * as cdk                                         from 'aws-cdk-lib';
import { App, BootstraplessSynthesizer }                from 'aws-cdk-lib';

import type { AdminApiAddonContext }                    from '../../../core/apis/addons';
import type { IIdentityProvisioner }                    from '../../../resources/lambdas/identity-provisioner-lambda';
import { AuditEventsQueue }                             from '../../../resources/queues/audit-events-queue';
import { DataTable }                                    from '../../../resources/tables/data-tables';

/** A resource of a synthesized template, as `Template.findResources` returns it. */
export type SynthesizedResource = ReturnType<Template['findResources']>[string];

/** The shared inputs a support addon is built from, on a stack with an explicit environment. */
export interface SupportTestStack {
  readonly stack:            cdk.Stack;
  readonly configTable:      DataTable;
  readonly auditEventsQueue: AuditEventsQueue;
  readonly artifactResolver: IArtifactResolver;
}

/**
 * Creates the stack, config table, audit queue and artifact resolver that the support addon
 * is built from. `context` is the CDK app context, used to override the vendor account IDs.
 */
export function createSupportTestStack(context?: Record<string, unknown>): SupportTestStack {
  const stack = new cdk.Stack(new App({ context }), 'test-stack', {
    env:         { account: '111122223333', region: 'us-east-1' },
    synthesizer: new BootstraplessSynthesizer(),
  });
  return {
    stack,
    configTable:      createDataTable(stack, 'config-table'),
    auditEventsQueue: new AuditEventsQueue(stack, 'audit-queue'),
    artifactResolver: createArtifactResolver(stack, '1.0.0'),
  };
}

export function createDataTable(stack: cdk.Stack, id: string): DataTable {
  return new DataTable(new Table(stack, id, {
    partitionKey: { name: 'pk', type: AttributeType.STRING },
    sortKey:      { name: 'sk', type: AttributeType.STRING },
  }));
}

export function createArtifactResolver(stack: cdk.Stack, goVersion: string): IArtifactResolver {
  return new PinnedArtifactResolver({
    packages:         { 'mailbox-go': { version: goVersion, zone: ArtifactZone.REGIONAL } },
    location:         { bucketBase: 'test-artifacts', project: 'serverlessinbox' },
    deploymentRegion: stack.region,
  });
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
    auditLogTable:       createDataTable(inputs.stack, 'audit-log-table'),
    identityProvisioner: unusedIdentityProvisioner,
    artifactResolver:    inputs.artifactResolver,
  };
}

/** An HTTP API and a Lambda authorizer to mount the addon's routes on. */
export function createApiWithAuthorizer(stack: cdk.Stack): { api: HttpApi; authorizer: HttpLambdaAuthorizer } {
  const authorizerFunction = new lambda.Function(stack, 'authorizer-function', {
    runtime: lambda.Runtime.NODEJS_20_X,
    handler: 'index.handler',
    code:    lambda.Code.fromInline('exports.handler = async () => ({ isAuthorized: true });'),
  });
  return {
    api:        new HttpApi(stack, 'api'),
    authorizer: new HttpLambdaAuthorizer('authorizer', authorizerFunction, {
      responseTypes: [HttpLambdaResponseType.SIMPLE],
    }),
  };
}

/** A synthesized Lambda function, found by the `SERVICE_NAME` its environment carries. */
export interface SynthesizedFunction {
  readonly logicalId:     string;
  readonly environment:   Record<string, unknown>;
  readonly roleLogicalId: string;
}

/** The parts of a synthesized `AWS::Lambda::Function` that `findFunction` reads. */
interface SynthesizedFunctionResource {
  readonly Properties: {
    readonly Role:         { readonly 'Fn::GetAtt': [string, string] };
    readonly Environment?: { readonly Variables: Record<string, unknown> };
  };
}

export function findFunction(template: Template, serviceName: string): SynthesizedFunction {
  // cast: CDK's findResources returns untyped template JSON; this is the one framework boundary.
  const functions = Object.entries(template.findResources('AWS::Lambda::Function')) as Array<[string, SynthesizedFunctionResource]>;
  const matches   = functions.filter(([, fn]) => fn.Properties.Environment?.Variables.SERVICE_NAME === serviceName);
  if (matches.length !== 1) {
    throw new Error(`expected one Lambda with SERVICE_NAME ${serviceName}, found ${matches.length}`);
  }
  const [[logicalId, fn]] = matches;
  return {
    logicalId,
    environment:   fn.Properties.Environment?.Variables ?? {},
    roleLogicalId: fn.Properties.Role['Fn::GetAtt'][0],
  };
}
