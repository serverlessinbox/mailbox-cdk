import { runExit }                  from 'clipanion';

import { BundleLambdaZipCommand }   from './commands/bundle-lambda-zip-command';
import { BundlePackageCommand }     from './commands/bundle-package-command';
import { CheckDeclarationsCommand } from './commands/check-declarations-command';

void runExit([BundlePackageCommand, BundleLambdaZipCommand, CheckDeclarationsCommand]);
