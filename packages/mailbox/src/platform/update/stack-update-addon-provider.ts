import type { IArtifactResolver }                                                              from '@serverlessinbox/artifact-registry-cdk';
import { Construct }                                                                           from 'constructs';

import { IAdminApiAddon, AdminApiAddonContext, IAdminApiAddonProvider }                        from '../../core/apis/addons';

import { StackUpdateAddon }                                                                    from './stack-update-addon';

/**
 * Settings of the {@link StackUpdateAddonProvider}: which template the stack is updated from and
 * which version it was deployed at.
 */
export interface StackUpdateAddonProviderProps {
  /**
   * The artifact resolver the stack-update Lambda's code is resolved through. Its registry
   * location (bucket base and project) also determines where the release pointer and the template
   * URL are read from. Pass the resolver your Mailbox uses, so the Lambda ships at the same
   * artifact version as the rest of the Mailbox.
   */
  readonly artifactResolver: IArtifactResolver;

  /**
   * Name of the template artifact the stack is updated from, for example `'mailbox-standard'`.
   * It selects the release pointer and the template URL the update flow reads.
   */
  readonly templateName: string;

  /**
   * The template version this stack was deployed from. It is stored as given in an SSM parameter
   * that the stack-update Lambda reads, so it must match the version actually deployed.
   */
  readonly templateVersion: string;

  /**
   * The release line (dist-tag) whose release pointer is read to find the template to update to.
   *
   * @default 'stable'
   */
  readonly distTag?: string;
}

/**
 * Enables human-gated CloudFormation ChangeSet operations in the Admin API: it mounts the
 * stack-update Lambda on `POST /stack-update/{proxy+}` behind the Admin API's authorizer and tells
 * the Admin UI that stack updates are available (`stackUpdate.available` in its config).
 *
 * Pass an instance in `MailboxProps.adminApiAddonProviders`. Nothing is enabled unless it is
 * listed there.
 */
export class StackUpdateAddonProvider implements IAdminApiAddonProvider {
  constructor(private readonly props: StackUpdateAddonProviderProps) {}

  /**
   * Creates the stack-update addon under `scope`, using the shared config table and audit queue
   * from `ctx` and the artifact resolver from this provider's props.
   *
   * @param scope The construct to create the addon under.
   * @param ctx The shared tables and queue the addon builds on.
   */
  createAdminApiAddons(scope: Construct, ctx: AdminApiAddonContext): IAdminApiAddon[] {
    return [
      new StackUpdateAddon(scope, 'stack-update-addon', {
        configTable:      ctx.configTable,
        auditEventsQueue: ctx.auditEventsQueue,
        artifactResolver: this.props.artifactResolver,
        templateName:     this.props.templateName,
        templateVersion:  this.props.templateVersion,
        distTag:          this.props.distTag,
      }),
    ];
  }
}
