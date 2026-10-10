import * as path from 'node:path';
import { loadEmbeddedArtifactVersions } from '@serverlessinbox/mailbox-cdk-shared';
import type { EmbeddedArtifactVersions } from '@serverlessinbox/mailbox-cdk-shared';

/** `artifact-versions.json` sits at the package root, one directory above both `src/` and `lib/`. */
const MAILBOX_COGNITO_ARTIFACT_VERSIONS_PATH = path.join(__dirname, '..', 'artifact-versions.json');

/** Loads the artifact versions committed with the `mailbox-cognito` package. */
export function loadMailboxCognitoArtifactVersions(): EmbeddedArtifactVersions {
  return loadEmbeddedArtifactVersions(MAILBOX_COGNITO_ARTIFACT_VERSIONS_PATH);
}
