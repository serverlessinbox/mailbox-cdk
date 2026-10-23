import { Cli }                    from 'clipanion';
import { join }                   from 'path';

import { LambdaZipBundler }       from '../../lambda-zip/lambda-zip-bundler';
import { BundleLambdaZipCommand } from '../bundle-lambda-zip-command';

const cli = Cli.from([BundleLambdaZipCommand]);

function fakeBundle() {
  return jest.spyOn(LambdaZipBundler, 'bundle').mockResolvedValue(undefined);
}

async function runCommand(...options: string[]): Promise<void> {
  await cli.process(['lambda-zip', ...options]).execute();
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe('BundleLambdaZipCommand', () => {
  it('defaults to a node24 target, minification on, and @aws-sdk/* external', async () => {
    const bundle = fakeBundle();

    await runCommand('--entry', 'src/handler.ts', '--out', 'dist/handler.zip');

    expect(bundle).toHaveBeenCalledWith({
      entryPath: join(process.cwd(), 'src/handler.ts'),
      outZip:    join(process.cwd(), 'dist/handler.zip'),
      target:    'node24',
      minify:    true,
      externals: ['@aws-sdk/*'],
    });
  });

  it('turns minification off with --no-minify', async () => {
    const bundle = fakeBundle();

    await runCommand('--entry', 'src/handler.ts', '--out', 'dist/handler.zip', '--no-minify');

    expect(bundle).toHaveBeenCalledWith(expect.objectContaining({ minify: false }));
  });

  it('splits --external on commas, trims each entry and drops empty ones', async () => {
    const bundle = fakeBundle();

    await runCommand('--entry', 'src/handler.ts', '--out', 'dist/handler.zip', '--external', '@aws-sdk/*, pkg-a ,,');

    expect(bundle).toHaveBeenCalledWith(expect.objectContaining({ externals: ['@aws-sdk/*', 'pkg-a'] }));
  });

  it('propagates a rejection from the bundler', async () => {
    jest.spyOn(LambdaZipBundler, 'bundle').mockRejectedValue(new Error('zip exited with code 3'));

    await expect(runCommand('--entry', 'src/handler.ts', '--out', 'dist/handler.zip')).rejects.toThrow('zip exited with code 3');
  });
});
