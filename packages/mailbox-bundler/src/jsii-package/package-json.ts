import { readFile } from 'fs/promises';
import { join }     from 'path';
import * as t       from 'typanion';

const isJsiiSettings = t.isPartial({
  excludeTypescript: t.isOptional(t.isArray(t.isString())),
});

/**
 * The `jsii` section of a package.json, reduced to the one field the bundler reads:
 * the TypeScript sources, relative to the package folder, that jsii excludes.
 */
export type JsiiSettings = t.InferType<typeof isJsiiSettings>;

const isExportsEntry = t.isOneOf([
  t.isString(),
  t.isPartial({ types: t.isOptional(t.isString()) }),
]);

/** One value of an `exports` map: a path, or the conditions of a subpath reduced to the `types` one. */
export type ExportsEntry = t.InferType<typeof isExportsEntry>;

const isPublishConfig = t.isPartial({
  exports: t.isOptional(t.isRecord(isExportsEntry)),
});

const isPackageJson = t.isPartial({
  name:          t.isOptional(t.isString()),
  publishConfig: t.isOptional(isPublishConfig),
  jsii:          t.isOptional(isJsiiSettings),
});

/**
 * A package's package.json, reduced to the fields the bundler reads: its name, the `exports` map
 * it publishes with, and the jsii settings. It is an npm document the bundler does not define,
 * so every other field is accepted and ignored.
 */
export type PackageJson = t.InferType<typeof isPackageJson>;

/**
 * Reads and validates `package.json` in the given folder. Rejects, naming the file path, when
 * the file cannot be read, is not valid JSON, or has a field the bundler reads of the wrong shape.
 */
export async function readPackageJson(packageFolder: string): Promise<PackageJson> {
  const packageJsonPath = join(packageFolder, 'package.json');
  const content         = await readFile(packageJsonPath, 'utf-8');

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`${packageJsonPath} is not valid JSON: ${reason}`);
  }

  const errors: string[] = [];
  if (!isPackageJson(parsed, { errors })) {
    throw new Error(`${packageJsonPath} has an unexpected shape: ${errors.join('; ')}`);
  }
  return parsed;
}
