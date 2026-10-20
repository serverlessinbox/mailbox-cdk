import { runExit }        from 'clipanion';

import { CaptureCommand } from './capture-command';
import { DiffCommand }    from './diff-command';

void runExit({ binaryName: 'yarn template-baseline' }, [CaptureCommand, DiffCommand]);
