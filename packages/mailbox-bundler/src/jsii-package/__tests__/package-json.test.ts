import { mkdtemp, rm, writeFile }  from 'fs/promises';
import { tmpdir }                  from 'os';
import { join }                    from 'path';

import { readPackageJson }         from '../package-json';

let packageFolder: string;
let packageJsonPath: string;

async function writePackageJson(content: string): Promise<void> {
  await writeFile(packageJsonPath, content);
}

beforeEach(async () => {
  packageFolder   = await mkdtemp(join(tmpdir(), 'package-json-test-'));
  packageJsonPath = join(packageFolder, 'package.json');
});

afterEach(async () => {
  await rm(packageFolder, { recursive: true, force: true });
});

describe('readPackageJson', () => {
  it('returns the jsii excludeTypescript paths', async () => {
    await writePackageJson('{"name":"pkg","jsii":{"excludeTypescript":["src/generated/**"]}}');

    await expect(readPackageJson(packageFolder)).resolves.toMatchObject({
      jsii: { excludeTypescript: ['src/generated/**'] },
    });
  });

  it('returns the name and the published exports, whether a subpath is a path or has conditions', async () => {
    await writePackageJson('{"name":"pkg","publishConfig":{"exports":{".":{"types":"./lib/index.d.ts","default":"./lib/index.js"},"./plain":"./lib/plain.js"}}}');

    await expect(readPackageJson(packageFolder)).resolves.toEqual({
      name:          'pkg',
      publishConfig: { exports: { '.': { types: './lib/index.d.ts', default: './lib/index.js' }, './plain': './lib/plain.js' } },
    });
  });

  it('rejects naming the file when a published exports entry has a types condition that is not a path', async () => {
    await writePackageJson('{"publishConfig":{"exports":{".":{"types":3}}}}');

    await expect(readPackageJson(packageFolder)).rejects.toThrow(`${packageJsonPath} has an unexpected shape`);
  });

  it('accepts a package without a jsii section', async () => {
    await writePackageJson('{"name":"pkg"}');

    await expect(readPackageJson(packageFolder)).resolves.toEqual({ name: 'pkg' });
  });

  it('ignores fields the bundler does not read', async () => {
    await writePackageJson('{"name":"pkg","version":"1.0.0","dependencies":{"x":"1"},"jsii":{"excludeTypescript":[]}}');

    await expect(readPackageJson(packageFolder)).resolves.toMatchObject({ jsii: { excludeTypescript: [] } });
  });

  it('rejects naming the file when package.json is missing', async () => {
    await expect(readPackageJson(packageFolder)).rejects.toThrow(packageJsonPath);
  });

  it('rejects naming the file when package.json is not valid JSON', async () => {
    await writePackageJson('{ "name": ');

    await expect(readPackageJson(packageFolder)).rejects.toThrow(`${packageJsonPath} is not valid JSON`);
  });

  it('rejects naming the file when the jsii section has the wrong shape', async () => {
    await writePackageJson('{"jsii":{"excludeTypescript":"src/a.ts"}}');

    await expect(readPackageJson(packageFolder)).rejects.toThrow(`${packageJsonPath} has an unexpected shape`);
  });

  it('rejects naming the offending field when excludeTypescript is not an array of strings', async () => {
    await writePackageJson('{"jsii":{"excludeTypescript":"src/a.ts"}}');

    await expect(readPackageJson(packageFolder)).rejects.toThrow(/excludeTypescript/);
  });
});
