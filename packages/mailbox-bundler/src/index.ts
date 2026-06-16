import { runExit } from 'clipanion';

import { BundlePackageCommand } from './bundle-package';
import { BundleLambdaZipCommand } from './bundle-lambda-zip';

void runExit([BundlePackageCommand, BundleLambdaZipCommand]);
