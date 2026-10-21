import type { Construct }                                               from 'constructs';

import { IAdminApiAddon, AdminApiAddonContext, IAdminApiAddonProvider } from '../../api/addons';

import { SupportAddon, SupportMode }                                    from './support-addon';

/** Settings of the {@link SupportAddonProvider}. */
export interface SupportAddonProviderProps {
  /**
   * Whether the support feature is provisioned. With `SupportMode.DISABLED` nothing is created and
   * no support routes are mounted. A CloudFormation parameter token defers the decision to deploy
   * time (see {@link SupportMode}).
   */
  readonly mode: SupportMode;
}

/**
 * Enables support case management in the Admin API: the support roles and policies, the support
 * case API mounted on `POST /support/{proxy+}` behind the Admin API's authorizer, and the
 * cross-account trust binding per case.
 *
 * Pass an instance in `MailboxProps.adminApiAddonProviders`. Nothing is enabled unless it is
 * listed there.
 */
export class SupportAddonProvider implements IAdminApiAddonProvider {
  constructor(private readonly props: SupportAddonProviderProps) {}

  /**
   * Creates the support addon under `scope`, using the shared config table, audit queue and
   * artifact resolver from `ctx`.
   *
   * @param scope The construct to create the addon under.
   * @param ctx The shared tables, queue and artifact resolver the addon builds on.
   */
  createAdminApiAddons(scope: Construct, ctx: AdminApiAddonContext): IAdminApiAddon[] {
    return [
      new SupportAddon(scope, 'support-addon', {
        mode: this.props.mode,
        artifactResolver: ctx.artifactResolver,
        configTable: ctx.configTable,
        auditEventsQueue: ctx.auditEventsQueue,
      }),
    ];
  }
}
