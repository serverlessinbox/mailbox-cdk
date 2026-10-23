import { Command, Option }     from 'clipanion';
import * as path               from 'node:path';

import { BaselineStore }       from './baseline-store';
import { BaselineSynthesizer } from './baseline-synthesizer';
import { FrozenProcessValues } from './frozen-process-values';

const BASELINE_ROOT = path.resolve(__dirname, '..', '..', '.template-baseline');

/**
 * What `capture` and `diff` share: the `--label` option and the construction of the baseline store
 * and the synthesizer. The subcommands add only what they do with them.
 */
export abstract class BaselineCommand extends Command {
  label = Option.String('--label', 'default', {
    description: 'Name of the baseline folder under .template-baseline: letters, digits, dot, underscore and dash. Defaults to "default"; given once.',
  });

  protected createStore(): BaselineStore {
    return new BaselineStore(BASELINE_ROOT);
  }

  protected createSynthesizer(): BaselineSynthesizer {
    return new BaselineSynthesizer(FrozenProcessValues.forBaseline());
  }
}
