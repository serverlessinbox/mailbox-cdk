import { runExit }                      from 'clipanion';

import { BuildCognitoDataStackCommand } from './build-cognito-data-stack-command';
import { BuildDataStackCommand }        from './build-data-stack-command';
import { BuildEdgeStackCommand }        from './build-edge-stack-command';

void runExit({ binaryName: 'yarn build-stack' }, [BuildDataStackCommand, BuildEdgeStackCommand, BuildCognitoDataStackCommand]);
