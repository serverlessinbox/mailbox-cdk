import * as path from 'path';
import { readFileSync } from 'fs';
import { Stack } from 'aws-cdk-lib';
import { Code } from 'aws-cdk-lib/aws-lambda';
import type { IConstruct } from 'constructs';
import { readArtifactVersions } from '@serverlessinbox/artifact-registry';
import type { ArtifactVersionsEntry, ArtifactZone } from '@serverlessinbox/artifact-registry';
import { CdkArtifactResolver } from './cdk-resolver';

export const COGNITO_ARTIFACT_PACKAGE = 'mailbox-cognito' as const;

const ARTIFACT_CONTEXT_KEY = 'artifacts';

export interface CreateCognitoArtifactOptions {
  readonly bucketBaseOverride?: string;
}

export function createCognitoArtifactData(
  scope: IConstruct,
  options?: CreateCognitoArtifactOptions,
): CdkArtifactResolver {
  const pkgRoot = path.join(__dirname, '..');
  const versionsPath = path.join(pkgRoot, 'artifact-versions.json');
  const pkgJsonPath = path.join(pkgRoot, 'package.json');

  const jsonVersions = readArtifactVersions(versionsPath);
  const packages: Record<string, ArtifactVersionsEntry> = { ...jsonVersions.packages };

  // mailbox-cognito is self-owned: inject from package.json as fallback
  const selfVersion: string = JSON.parse(readFileSync(pkgJsonPath, 'utf-8')).version;
  if (!(COGNITO_ARTIFACT_PACKAGE in packages)) {
    packages[COGNITO_ARTIFACT_PACKAGE] = { version: selfVersion, zone: 'regional' as ArtifactZone };
  }

  // Context-first: context.artifacts.packages overrides everything including self-owned
  const contextValue = scope.node.tryGetContext(ARTIFACT_CONTEXT_KEY);
  let bucketBaseOverride = options?.bucketBaseOverride;
  if (contextValue && typeof contextValue === 'object') {
    bucketBaseOverride ??= contextValue.bucketBase;
    const contextPackages = contextValue.packages;
    if (contextPackages && typeof contextPackages === 'object') {
      for (const [name, target] of Object.entries(contextPackages as Record<string, unknown>)) {
        const t = target as Record<string, unknown>;
        const existingZone: ArtifactZone = packages[name]?.zone ?? 'regional';
        if (t?.kind === 'channel' && typeof t.channel === 'string') {
          packages[name] = { version: t.channel, zone: existingZone, channel: t.channel };
        } else if (t?.kind === 'release' && typeof t.version === 'string') {
          packages[name] = { version: t.version, zone: existingZone };
        }
      }
    }
  }

  const versionMap = scope.node.tryGetContext('artifactVersions') as Record<string, string> | undefined;
  return new CdkArtifactResolver({
    versions: { bucketBase: jsonVersions.bucketBase, packages },
    bucketBaseOverride,
    deploymentRegion: Stack.of(scope).region,
    s3VersionMap: versionMap,
  }, scope);
}

export function getCognitoLambdaCode(scope: IConstruct, objectPath: string, options?: CreateCognitoArtifactOptions): Code {
  const resolver = createCognitoArtifactData(scope, options);
  return resolver.getCode(COGNITO_ARTIFACT_PACKAGE, objectPath);
}

export function getCognitoDataStackTemplateUrl(scope: IConstruct, options?: CreateCognitoArtifactOptions): string {
  const resolver = createCognitoArtifactData(scope, options);
  return resolver.getUrl(COGNITO_ARTIFACT_PACKAGE, 'cognito-data-stack-template.json');
}

export function getCognitoDataStackTemplateArn(scope: IConstruct, options?: CreateCognitoArtifactOptions): string {
  const resolver = createCognitoArtifactData(scope, options);
  return resolver.getArn(COGNITO_ARTIFACT_PACKAGE, 'cognito-data-stack-template.json');
}
