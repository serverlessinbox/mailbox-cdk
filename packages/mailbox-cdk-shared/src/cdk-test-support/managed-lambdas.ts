/// <reference types="jest" />

import { access } from 'node:fs/promises';
import * as path from 'node:path';
import type { Template } from 'aws-cdk-lib/assertions';

/** A function of a synthesized template that the artifact updater manages, as the template describes it. */
export interface ManagedLambda {
  readonly logicalId: string;
  readonly artifactName: string;
  readonly packageName: string;
  readonly autoUpdateType: string;
  readonly handlerExport: string;
  readonly environment: Record<string, string>;
}

/** The part of a synthesized `AWS::Lambda::Function` these helpers read. */
interface LambdaFunctionResource {
  readonly Type: string;
  readonly Properties?: {
    readonly Handler?: string;
    readonly Tags?: ReadonlyArray<{ readonly Key: string; readonly Value: unknown }>;
    readonly Environment?: { readonly Variables?: Record<string, unknown> };
  };
}

/** An invocation outcome: whether the handler answered the probe, whether it was reached at all, and what happened. */
export interface ProbeOutcome {
  readonly answered: boolean;
  readonly handlerReached: boolean;
  readonly detail: string;
}

const AUTO_UPDATE_TYPE_TAG = 'serverless-inbox:auto-update-type';
const ARTIFACT_NAME_TAG = 'serverless-inbox:artifact-name';
const ARTIFACT_PACKAGE_TAG = 'serverless-inbox:artifact-package';
const MANAGED_UPDATE_TYPES = ['code', 'edge'];
const PROBE = { serverlessInboxSmokeTest: true };
const PLACEHOLDER_FOR_TOKEN = 'resolved-at-deploy-time';

/**
 * Every function of the template that the artifact updater manages: those tagged with an auto-update-type of
 * `code` or `edge`. Throws when such a function lacks its artifact-name or artifact-package tag.
 */
export function managedLambdasOf(template: Template): ManagedLambda[] {
  const resources = template.toJSON().Resources as Record<string, LambdaFunctionResource>;
  const managed: ManagedLambda[] = [];

  for (const [logicalId, resource] of Object.entries(resources)) {
    if (resource.Type !== 'AWS::Lambda::Function') {
      continue;
    }
    const tags = resource.Properties?.Tags ?? [];
    const autoUpdateType = tags.find((tag) => tag.Key === AUTO_UPDATE_TYPE_TAG)?.Value;
    const artifactName = tags.find((tag) => tag.Key === ARTIFACT_NAME_TAG)?.Value;
    if (typeof autoUpdateType !== 'string' || !MANAGED_UPDATE_TYPES.includes(autoUpdateType)) {
      continue;
    }
    const packageName = tags.find((tag) => tag.Key === ARTIFACT_PACKAGE_TAG)?.Value;
    if (typeof artifactName !== 'string' || typeof packageName !== 'string') {
      throw new Error(`Managed Lambda ${logicalId} has no artifact-name or artifact-package tag`);
    }
    managed.push({
      logicalId,
      artifactName,
      packageName,
      autoUpdateType,
      handlerExport: (resource.Properties?.Handler ?? '').split('.').slice(1).join('.'),
      environment: environmentOf(resource.Properties?.Environment?.Variables ?? {}),
    });
  }
  return managed;
}

/**
 * The bundle entry (`<root>/<artifactName>/index.ts`) of an artifact among the given source folders, or
 * undefined when none holds it. Throws when more than one does.
 */
export async function handlerSourceOf(artifactName: string, roots: readonly string[]): Promise<string | undefined> {
  const found: string[] = [];
  for (const root of roots) {
    const entry = path.join(root, artifactName, 'index.ts');
    try {
      await access(entry);
      found.push(entry);
    } catch {
      // This root does not hold the artifact.
    }
  }
  if (found.length > 1) {
    throw new Error(`Artifact ${artifactName} has more than one bundle entry: ${found.join(', ')}`);
  }
  return found[0];
}

/**
 * Invokes the handler at `source` with the smoke-test probe, under the environment the template gives the
 * Lambda, and reports whether it answered with a boolean `serverlessInboxSmokeTestOk`.
 */
export async function probeManagedLambda(lambda: ManagedLambda, source: string): Promise<ProbeOutcome> {
  const originalEnvironment = { ...process.env };
  Object.assign(process.env, lambda.environment);

  try {
    return await invokeProbe(lambda, loadHandlerModule(source));
  } finally {
    process.env = originalEnvironment;
  }
}

/** A value CloudFormation resolves at deploy time has no value yet; the placeholder stands in for it. */
function environmentOf(variables: Record<string, unknown>): Record<string, string> {
  const environment: Record<string, string> = {};
  for (const [name, value] of Object.entries(variables)) {
    environment[name] = typeof value === 'string' ? value : PLACEHOLDER_FOR_TOKEN;
  }
  return environment;
}

/** The handler module as a fresh Lambda cold start loads it, so its module-scope configuration is read again. */
function loadHandlerModule(source: string): Record<string, unknown> | Error {
  let loaded: Record<string, unknown> | Error = new Error('module was not loaded');
  jest.isolateModules(() => {
    try {
      loaded = jest.requireActual<Record<string, unknown>>(source);
    } catch (thrown) {
      loaded = thrown instanceof Error ? thrown : new Error(String(thrown));
    }
  });
  return loaded;
}

async function invokeProbe(lambda: ManagedLambda, loaded: Record<string, unknown> | Error): Promise<ProbeOutcome> {
  if (loaded instanceof Error) {
    return { answered: false, handlerReached: false, detail: `loading the module threw ${loaded.message}` };
  }
  const handler = loaded[lambda.handlerExport];
  if (typeof handler !== 'function') {
    return { answered: false, handlerReached: false, detail: `the module exports no function ${lambda.handlerExport}` };
  }

  try {
    const answer: unknown = await handler(PROBE, {});
    return { answered: isSmokeTestAnswer(answer), handlerReached: true, detail: `answered ${JSON.stringify(answer)}` };
  } catch (thrown) {
    const message = thrown instanceof Error ? thrown.message : String(thrown);
    return { answered: false, handlerReached: true, detail: `the handler threw ${message}` };
  }
}

function isSmokeTestAnswer(answer: unknown): boolean {
  return (
    typeof answer === 'object' &&
    answer !== null &&
    'serverlessInboxSmokeTestOk' in answer &&
    typeof answer.serverlessInboxSmokeTestOk === 'boolean'
  );
}
