import { runExit }                from 'clipanion';

import { BundleLambdaZipCommand } from './commands/bundle-lambda-zip-command';
import { BundlePackageCommand }   from './commands/bundle-package-command';

void runExit([BundlePackageCommand, BundleLambdaZipCommand]);
