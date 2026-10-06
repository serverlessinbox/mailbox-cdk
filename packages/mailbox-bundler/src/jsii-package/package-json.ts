import { readFile } from 'fs/promises';
import { join } from 'path';
import * as t from 'typanion';

const isJsiiSettings = t.isPartial({
  excludeTypescript: t.isOptional(t.isArray(t.isString())),
});

/**
 * The `jsii` section of a package.json, reduced to the one field the bundler reads:
 * the TypeScript sources, relative to the package folder, that jsii excludes.
 */
export type JsiiSettings = t.InferType<typeof isJsiiSettings>;

const isPackageJson = t.isPartial({
  jsii: t.isOptional(isJsiiSettings),
});

/**
 * A jsii package's package.json, reduced to the fields the bundler reads. It is an npm
 * document the bundler does not define, so every other field is accepted and ignored.
 */
export type PackageJson = t.InferType<typeof isPackageJson>;

/**
 * Reads and validates `package.json` in the given folder. Rejects, naming the file path, when
 * the file cannot be read, is not valid JSON, or has a `jsii` section of the wrong shape.
 */
export async function readPackageJson(packageFolder: string): Promise<PackageJson> {
  const packageJsonPath = join(packageFolder, 'package.json');
  const content = await readFile(packageJsonPath, 'utf-8');

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
