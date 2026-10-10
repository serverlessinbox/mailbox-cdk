import { readFile } from 'node:fs/promises';
import * as path from 'node:path';
import * as t from 'typanion';

const SEMVER = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$/;

const isPackageJson = t.isPartial({
  version: t.cascade(t.isString(), t.matchesRegExp(SEMVER)),
});

/** An npm `package.json`, reduced to the version `gitversion bump` writes. */
type PackageJson = t.InferType<typeof isPackageJson>;

/**
 * Reads the version `gitversion bump` wrote into a package's `package.json`. It only reads: it
 * never computes or defaults a version, so a manifest the bump did not reach fails here.
 */
export class BumpedVersionReader {
  public async readBumpedVersion(manifestDirectory: string): Promise<string> {
    const manifestPath = path.join(manifestDirectory, 'package.json');
    const packageJson = await this.readPackageJson(manifestPath);
    return packageJson.version;
  }

  private async readPackageJson(manifestPath: string): Promise<PackageJson> {
    let text: string;
    try {
      text = await readFile(manifestPath, 'utf8');
    } catch (error) {
      throw new Error(`${manifestPath}: cannot be read: ${error instanceof Error ? error.message : String(error)}`);
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (error) {
      throw new Error(`${manifestPath}: is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
    }

    const errors: string[] = [];
    if (!isPackageJson(parsed, { errors })) {
      throw new Error(`${manifestPath}: has no semver "version": ${errors.join('; ')}`);
    }
    return parsed;
  }
}
