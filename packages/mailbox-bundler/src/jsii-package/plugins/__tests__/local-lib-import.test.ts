import { build }                                   from 'esbuild';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'fs/promises';
import { tmpdir }                                  from 'os';
import { dirname, join }                           from 'path';

import { localLibImportPlugin }                    from '../local-lib-import';

interface FixtureFile {
  readonly path:    string;
  readonly content: string;
}

let root: string;
let packageFolder: string;

async function writeFixtures(files: FixtureFile[]): Promise<void> {
  for (const file of files) {
    const target = join(root, file.path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, file.content);
  }
}

async function bundleFrom(entryPath: string): Promise<string> {
  const result = await build({
    entryPoints: [entryPath],
    bundle:      true,
    write:       false,
    platform:    'node',
    format:      'cjs',
    plugins:     [localLibImportPlugin(packageFolder)],
  });
  return result.outputFiles.map(file => file.text).join('\n');
}

beforeEach(async () => {
  root          = await realpath(await mkdtemp(join(tmpdir(), 'local-lib-import-test-')));
  packageFolder = join(root, 'mailbox');
  await writeFixtures([
    { path: 'mailbox/src/entry.js',                content: "import { h } from './helper.js';\nconsole.log(h);" },
    { path: 'mailbox/src/helper.js',                content: "module.exports = { h: 'HELPER_MARKER' };" },
    { path: 'outside/entry.js',                     content: "import { h } from '../mailbox/src/helper.js';\nconsole.log(h);" },
    { path: 'mailbox-cdk-shared/entry.js',          content: "import { s } from './helper.js';\nconsole.log(s);" },
    { path: 'mailbox-cdk-shared/helper.js',         content: "module.exports = { s: 'SIBLING_HELPER_MARKER' };" },
    { path: 'node_modules/plain-lib/index.js',      content: "module.exports = { p: 'PLAIN_LIB_MARKER' };" },
  ]);
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('localLibImportPlugin', () => {
  it('leaves a relative import made by a file in the package external', async () => {
    const output = await bundleFrom(join(packageFolder, 'src', 'entry.js'));

    expect(output).toContain('require("./helper.js")');
    expect(output).not.toContain('HELPER_MARKER');
  });

  it('bundles a relative import made by a file outside the package folder', async () => {
    const output = await bundleFrom(join(root, 'outside', 'entry.js'));

    expect(output).toContain('HELPER_MARKER');
  });

  it('currently leaves a relative import of a sibling folder that shares the name prefix external (BND-15, pinned current behaviour)', async () => {
    const output = await bundleFrom(join(root, 'mailbox-cdk-shared', 'entry.js'));

    expect(output).toContain('require("./helper.js")');
    expect(output).not.toContain('SIBLING_HELPER_MARKER');
  });

  it('does not judge non-relative imports', async () => {
    await writeFile(join(packageFolder, 'src', 'plain.js'), "import { p } from 'plain-lib';\nconsole.log(p);");

    const output = await bundleFrom(join(packageFolder, 'src', 'plain.js'));

    expect(output).toContain('PLAIN_LIB_MARKER');
  });

  it('does not judge require calls', async () => {
    await writeFile(join(packageFolder, 'src', 'required.js'), "const { h } = require('./helper.js');\nconsole.log(h);");

    const output = await bundleFrom(join(packageFolder, 'src', 'required.js'));

    expect(output).toContain('HELPER_MARKER');
  });
});
