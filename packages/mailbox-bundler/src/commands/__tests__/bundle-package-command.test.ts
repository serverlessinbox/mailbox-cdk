import { Cli }                   from 'clipanion';
import { tmpdir }                from 'os';
import { join }                  from 'path';

import { bundleJsiiPackage }     from '../../jsii-package/bundle-jsii-package';
import { readPackageJson }       from '../../jsii-package/package-json';
import { BundlePackageCommand }  from '../bundle-package-command';

jest.mock('../../jsii-package/bundle-jsii-package');
jest.mock('../../jsii-package/package-json');

const cli = Cli.from([BundlePackageCommand]);

async function runCommand(packageFolder: string): Promise<void> {
  await cli.process(['package', packageFolder]).execute();
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('BundlePackageCommand', () => {
  it('resolves a relative package folder against the current directory', async () => {
    jest.mocked(readPackageJson).mockResolvedValue({});

    await runCommand('pkg');

    expect(readPackageJson).toHaveBeenCalledWith(join(process.cwd(), 'pkg'));
    expect(bundleJsiiPackage).toHaveBeenCalledWith(join(process.cwd(), 'pkg'), []);
  });

  it('uses an absolute package folder as given', async () => {
    const absolutePackage = join(tmpdir(), 'abs-pkg');
    jest.mocked(readPackageJson).mockResolvedValue({});

    await runCommand(absolutePackage);

    expect(readPackageJson).toHaveBeenCalledWith(absolutePackage);
    expect(bundleJsiiPackage).toHaveBeenCalledWith(absolutePackage, []);
  });

  it('passes the jsii excludeTypescript paths on to the bundler', async () => {
    jest.mocked(readPackageJson).mockResolvedValue({ jsii: { excludeTypescript: ['src/generated/**'] } });

    await runCommand('pkg');

    expect(bundleJsiiPackage).toHaveBeenCalledWith(join(process.cwd(), 'pkg'), ['src/generated/**']);
  });

  it('rejects without bundling when package.json cannot be read', async () => {
    jest.mocked(readPackageJson).mockRejectedValue(new Error('unreadable package.json'));

    await expect(runCommand('pkg')).rejects.toThrow('unreadable package.json');
    expect(bundleJsiiPackage).not.toHaveBeenCalled();
  });
});
