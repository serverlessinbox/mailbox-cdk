import { ArtifactZone, PinnedArtifactResolver } from '@serverlessinbox/artifact-registry-cdk';
import type { ArtifactPin, IArtifactResolver }  from '@serverlessinbox/artifact-registry-cdk';
import type { PolicyStatementJson }             from '@serverlessinbox/mailbox-cdk-shared/cdk-test-support';
import { statementsForRole }                    from '@serverlessinbox/mailbox-cdk-shared/cdk-test-support';
import { ServerlessInboxTagKeys }               from '@serverlessinbox/mailbox-cdk-shared';
import type { Template }                        from 'aws-cdk-lib/assertions';
import { App, BootstraplessSynthesizer, Stack } from 'aws-cdk-lib';

/** The stack and resolver every wrapper test arranges before it adds its own tables and wrapper. */
export interface WrapperArrangement {
  readonly app:              App;
  readonly stack:            Stack;
  readonly artifactResolver: IArtifactResolver;
}

/** The packages a wrapper test pins unless it passes its own. */
const DEFAULT_PACKAGES: Record<string, ArtifactPin> = {
  'mailbox-go': { version: '1.0.0', zone: ArtifactZone.REGIONAL },
};

const DEFAULT_BUCKET_BASE = 'test-artifacts';
const DEFAULT_PROJECT     = 'serverlessinbox';

/**
 * Builds the stack a wrapper test runs in: an explicit environment, bootstrapless synthesis and a resolver pinned to the
 * given packages, read from the given bucket base and project.
 */
export function arrangeWrapperStack(
  packages: Record<string, ArtifactPin> = DEFAULT_PACKAGES,
  bucketBase: string = DEFAULT_BUCKET_BASE,
  project: string = DEFAULT_PROJECT,
): WrapperArrangement {
  const app              = new App();
  const stack            = new Stack(app, 'TestStack', {
    env:         { account: '123456789012', region: 'us-west-2' },
    synthesizer: new BootstraplessSynthesizer(),
  });
  const artifactResolver = new PinnedArtifactResolver({
    packages,
    location:         { bucketBase, project },
    deploymentRegion: stack.region,
  });
  return { app, stack, artifactResolver };
}

/** The two conditions that admit a resource owned by a root stack: its id tag, or its name tag when it carries no id tag. */
export interface OwnedByRootStack {
  readonly byId:   Record<string, unknown>;
  readonly byName: Record<string, unknown>;
}

/** The ownership conditions for a root stack, read from a resource tag or from a request tag. */
export function ownedByRootStack(tagScope: 'ResourceTag' | 'RequestTag', rootStack: string, rootStackId: string): OwnedByRootStack {
  const stackIdKey = `aws:${tagScope}/${ServerlessInboxTagKeys.rootStackId}`;
  const stackKey   = `aws:${tagScope}/${ServerlessInboxTagKeys.rootStack}`;
  return {
    byId:   { StringEquals: { [stackIdKey]: rootStackId } },
    byName: { StringEquals: { [stackKey]: rootStack }, Null: { [stackIdKey]: 'true' } },
  };
}

/** Turns a synthesized Lambda environment into the process environment its runtime configuration loader reads; a non-string value throws. */
export function processEnvironmentOf(environment: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(environment).map(([name, value]) => {
      if (typeof value !== 'string') {
        throw new Error(`Environment variable ${name} is not a plain string in the template: ${JSON.stringify(value)}`);
      }
      return [name, value];
    }),
  );
}

/** The parts of a synthesized `AWS::Lambda::Function` that the wrapper tests read. */
interface SynthesizedFunctionResource {
  readonly Properties: {
    readonly Role:        { readonly 'Fn::GetAtt': [string, string] };
    readonly Environment: { readonly Variables: Record<string, unknown> };
  };
}

/** The only Lambda function of a synthesized stack: its logical ID, its environment and the statements of its role. */
export interface SynthesizedLambda {
  readonly logicalId:   string;
  readonly environment: Record<string, unknown>;
  readonly statements:  PolicyStatementJson[];
}

/** Reads the one Lambda function a wrapper test builds; a stack with any other number throws. */
export function onlyLambdaOf(template: Template): SynthesizedLambda {
  // cast: CDK's findResources returns untyped template JSON; this is the one framework boundary.
  const functions = Object.entries(template.findResources('AWS::Lambda::Function')) as Array<[string, SynthesizedFunctionResource]>;
  if (functions.length !== 1) {
    throw new Error(`expected one Lambda function, found ${functions.length}`);
  }
  const [[logicalId, resource]] = functions;
  return {
    logicalId,
    environment: resource.Properties.Environment.Variables,
    statements:  statementsForRole(template, resource.Properties.Role['Fn::GetAtt'][0]),
  };
}
