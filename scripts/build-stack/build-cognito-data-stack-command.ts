import type { App, Stack }                    from 'aws-cdk-lib';

import { COGNITO_DATA_STACK_TEMPLATE_OBJECT } from '../../packages/mailbox-cognito/src/data-stack/mailbox-cognito-data-stack-contract';
import type { StandaloneStackFactory }        from '../stacks/standalone-stack-factory';

import { BuildStackCommand }                  from './build-stack-command';

/** `build-stack cognito-data`: writes the standalone cognito data stack template. */
export class BuildCognitoDataStackCommand extends BuildStackCommand {
  static paths = [['cognito-data']];
  static usage = BuildStackCommand.Usage({
    description: 'Synthesize the standalone cognito data stack and write its template as formatted JSON to <out-dir>/cognito-data-stack-template.json.',
    examples:    [
      ['Build the cognito data stack template into dist', 'yarn build-stack cognito-data --out-dir /abs/path/dist'],
    ],
  });

  protected readonly templateFileName = COGNITO_DATA_STACK_TEMPLATE_OBJECT;

  protected createStack(factory: StandaloneStackFactory, app: App): Stack {
    return factory.createCognitoDataStack(app);
  }
}
