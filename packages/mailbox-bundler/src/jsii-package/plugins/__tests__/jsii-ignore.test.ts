import { build }                         from 'esbuild';
import { mkdir, mkdtemp, rm, writeFile } from 'fs/promises';
import { tmpdir }                        from 'os';
import { dirname, join }                 from 'path';

import { jsiiIgnorePlugin }              from '../jsii-ignore';

interface FixtureFile {
  readonly path:    string;
  readonly content: string;
}

const fixtures: FixtureFile[] = [
  { path: 'node_modules/jsii-lib/.jsii',               content: '{}' },
  { path: 'node_modules/jsii-lib/index.js',            content: "module.exports = { a: 'JSII_LIB_MARKER' };" },
  { path: 'node_modules/jsii-lib/sub/file.js',         content: "module.exports = { f: 'JSII_SUB_MARKER' };" },
  { path: 'node_modules/@scope/pkg/.jsii',             content: '{}' },
  { path: 'node_modules/@scope/pkg/index.js',          content: 'module.exports = {};' },
  { path: 'node_modules/@scope/pkg/sub/file.js',       content: "module.exports = { s: 'SCOPED_SUB_MARKER' };" },
  { path: 'node_modules/plain-lib/index.js',           content: "module.exports = { p: 'PLAIN_LIB_MARKER' };" },
  { path: 'pkg/index.js',                              content: 'module.exports = {};' },
  { path: 'pkg/relative.js',                           content: "module.exports = { r: 'RELATIVE_MARKER' };" },
  { path: 'empty/placeholder.txt',                     content: 'no entry file here' },
];

let root: string;
let packageFolder: string;
let entryPath: string;

async function writeFixtures(files: FixtureFile[]): Promise<void> {
  for (const file of files) {
    const target = join(root, file.path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, file.content);
  }
}

async function bundleEntry(source: string): Promise<string> {
  await writeFile(entryPath, source);
  const result = await build({
    entryPoints: [entryPath],
    bundle:      true,
    write:       false,
    platform:    'node',
    format:      'cjs',
    plugins:     [jsiiIgnorePlugin(packageFolder)],
  });
  return result.outputFiles.map(file => file.text).join('\n');
}

beforeEach(async () => {
  root          = await mkdtemp(join(tmpdir(), 'jsii-ignore-test-'));
  packageFolder = join(root, 'pkg');
  entryPath     = join(packageFolder, 'entry.js');
  await writeFixtures(fixtures);
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('jsiiIgnorePlugin', () => {
  it('leaves an import of a jsii package external', async () => {
    const output = await bundleEntry("import { a } from 'jsii-lib';\nconsole.log(a);");

    expect(output).toContain('require("jsii-lib")');
    expect(output).not.toContain('JSII_LIB_MARKER');
  });

  it('bundles an import of a package that ships no .jsii', async () => {
    const output = await bundleEntry("import { p } from 'plain-lib';\nconsole.log(p);");

    expect(output).toContain('PLAIN_LIB_MARKER');
    expect(output).not.toContain('require("plain-lib")');
  });

  it('judges a deep import by the nearest ancestor package', async () => {
    const output = await bundleEntry("import { f } from 'jsii-lib/sub/file';\nconsole.log(f);");

    expect(output).toContain('require("jsii-lib/sub/file")');
    expect(output).not.toContain('JSII_SUB_MARKER');
  });

  it('judges a scoped deep import by its scope package', async () => {
    const output = await bundleEntry("import { s } from '@scope/pkg/sub/file';\nconsole.log(s);");

    expect(output).toContain('require("@scope/pkg/sub/file")');
    expect(output).not.toContain('SCOPED_SUB_MARKER');
  });

  it('does not judge relative imports', async () => {
    const output = await bundleEntry("import { r } from './relative';\nconsole.log(r);");

    expect(output).toContain('RELATIVE_MARKER');
  });

  it('does not judge require calls', async () => {
    const output = await bundleEntry("const { a } = require('jsii-lib');\nconsole.log(a);");

    expect(output).toContain('JSII_LIB_MARKER');
  });

  it('fails at plugin creation when the package main does not resolve (BND-12, current behaviour)', () => {
    const emptyFolder = join(root, 'empty');

    expect(() => jsiiIgnorePlugin(emptyFolder)).toThrow('Cannot find module');
  });
});
