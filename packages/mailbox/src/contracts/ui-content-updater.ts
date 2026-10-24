import type { IGrantable } from 'aws-cdk-lib/aws-iam';

/**
 * A UI that can grant write access to its content bucket, so an artifact updater may deploy the
 * UI's release content.
 */
export interface IUiContentDeployTarget {
  /**
   * Grants `grantee` permission to deploy content to this UI's bucket, and nothing more.
   *
   * @param grantee The principal that is allowed to write the UI's content.
   */
  grantContentDeploy(grantee: IGrantable): void;
}

/**
 * An artifact resolver that keeps a UI's content up to date, and so must be given write access to
 * that UI's content bucket.
 */
export interface IUiContentUpdater {
  /**
   * Gives this updater write access to the content of `ui`.
   *
   * @param ui The UI whose content the updater writes on updates.
   */
  enableUiContentUpdate(ui: IUiContentDeployTarget): void;
}
