import { Command, Option }     from 'clipanion';
import * as path               from 'node:path';

import { BaselineStore }       from './baseline-store';
import { BaselineSynthesizer } from './baseline-synthesizer';
import { FrozenProcessValues } from './frozen-process-values';

const DEFAULT_BASELINE_ROOT_SEGMENTS = ['..', '..', '.template-baseline'];

/**
 * Base class of the baseline subcommands. It owns the `--label` and `--baseline-root` options and
 * builds the baseline store and the synthesizer; each subcommand decides what it does with them.
 */
export abstract class BaselineCommand extends Command {
  label = Option.String('--label', 'default', {
    description: 'Name of the baseline folder under .template-baseline: letters, digits, dot, underscore and dash. Defaults to "default"; given once.',
  });

  baselineRoot = Option.String('--baseline-root', {
    description: 'Folder that holds the label folders. Defaults to .template-baseline in the mailbox-cdk root; given once.',
  });

  protected createStore(): BaselineStore {
    return new BaselineStore(path.resolve(this.baselineRoot ?? path.resolve(__dirname, ...DEFAULT_BASELINE_ROOT_SEGMENTS)));
  }

  protected createSynthesizer(): BaselineSynthesizer {
    return new BaselineSynthesizer(FrozenProcessValues.forBaseline());
  }
}
