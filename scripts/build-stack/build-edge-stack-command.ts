import type { App, Stack }             from 'aws-cdk-lib';

import type { StandaloneStackFactory } from '../stacks/standalone-stack-factory';

import { BuildStackCommand }           from './build-stack-command';

/** `build-stack edge`: writes the standalone edge stack template. */
export class BuildEdgeStackCommand extends BuildStackCommand {
  static paths = [['edge']];
  static usage = BuildStackCommand.Usage({
    description: 'Synthesize the standalone edge stack and write its template as formatted JSON to <out-dir>/edge-stack-template.json.',
    examples:    [
      ['Build the edge stack template into dist', 'yarn build-stack edge --out-dir /abs/path/dist'],
    ],
  });

  protected readonly templateFileName = 'edge-stack-template.json';

  protected createStack(factory: StandaloneStackFactory, app: App): Stack {
    return factory.createEdgeStack(app);
  }
}
