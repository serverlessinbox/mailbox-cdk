import type { App, Stack }             from 'aws-cdk-lib';

import type { StandaloneStackFactory } from '../stacks/standalone-stack-factory';

import { BuildStackCommand }           from './build-stack-command';

/** `build-stack data`: writes the standalone data stack template. */
export class BuildDataStackCommand extends BuildStackCommand {
  static paths = [['data']];
  static usage = BuildStackCommand.Usage({
    description: 'Synthesize the standalone data stack and write its template as formatted JSON to <out-dir>/data-stack-template.json.',
    examples:    [
      ['Build the data stack template into dist', 'yarn build-stack data --out-dir /abs/path/dist'],
    ],
  });

  protected readonly templateFileName = 'data-stack-template.json';

  protected createStack(factory: StandaloneStackFactory, app: App): Stack {
    return factory.createDataStack(app);
  }
}
