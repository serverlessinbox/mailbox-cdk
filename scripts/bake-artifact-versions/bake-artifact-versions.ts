import { runExit } from 'clipanion';
import { BakeArtifactVersionsCommand } from './bake-artifact-versions-command';

void runExit({ binaryName: 'yarn bake-artifact-versions' }, [BakeArtifactVersionsCommand]);
