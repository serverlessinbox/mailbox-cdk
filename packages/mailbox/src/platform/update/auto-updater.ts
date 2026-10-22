import type { IArtifactResolver, RegistryLocation, ResolvedArtifact }            from '@serverlessinbox/artifact-registry-cdk';
import { MailboxArtifactResolverFactory, ServerlessInboxTagKeys, StackIdentity } from '@serverlessinbox/mailbox-cdk-shared';
import * as iam                                                                  from 'aws-cdk-lib/aws-iam';
import * as lambda                                                               from 'aws-cdk-lib/aws-lambda';
import { Aws, Duration, Fn, Tags }                                               from 'aws-cdk-lib';
import * as cdk                                                                  from 'aws-cdk-lib';
import { Construct, IConstruct }                                                 from 'constructs';

import type { IAdminApiAddon, AdminApiAddonContext, IAdminApiAddonProvider }     from '../../core/apis/addons';
import { loadMailboxArtifactVersions }                                           from '../../mailbox-artifact-versions';
import { loadMailboxRegistryRecord }                                             from '../../mailbox-registry-record';
import { ArtifactUpdaterLambda }                                                 from '../../resources/lambdas/artifact-updater-lambda';

import { ArtifactUpdaterAddon }                                                  from './artifact-updater-addon';
import { TrackedUpdateTriggers }                                                 from './tracked-update-triggers';

/**
 * How the artifact updater follows new releases.
 *
 * - `'major'`: the updater derives the release track from the major number of a deployed
 *   artifact's version (`1.4.2` follows track `v1`) and moves the artifact to any strictly newer
 *   version on that track, so new minor releases are adopted automatically.
 * - `'minor'`: the updater derives the track from the major and minor numbers (`1.4.2` follows
 *   track `v1.4`), so only patch releases are adopted automatically. This is the default of
 *   {@link AutoUpdaterProps.granularity}.
 * - `'pinned'`: automatic updates are off. The post-deploy trigger and the schedule are not
 *   created and the deployed artifacts change only when you deploy a new template or invoke the
 *   updater from the admin API.
 *
 * For `'major'` and `'minor'` the updater reads the release pointer of the derived track for the
 * configured dist-tag and moves the artifact only to a strictly newer version.
 */
export type Granularity = 'major' | 'minor' | 'pinned';

/**
 * Settings of the {@link AutoUpdater}: which release line to follow, how tightly, and how often
 * the scheduled check runs.
 */
export interface AutoUpdaterProps {
  /**
   * The release line (dist-tag) the updater follows, for example `'stable'`. The updater reads
   * the release pointer published for this tag and moves deployed artifacts to the version it
   * names.
   *
   * @default 'stable'
   */
  readonly distTag?: string;

  /**
   * How the updater follows new releases. The literal values are those of {@link Granularity}:
   * `'major'`, `'minor'` or `'pinned'`. With `'pinned'` the post-deploy trigger and the schedule
   * are not created, and the updater only runs when invoked from the admin API.
   *
   * Accepts a CloudFormation parameter token, so a stack parameter can switch tracking on and
   * off at deploy time. The prop is typed `string` for that reason, so a literal that is not a
   * {@link Granularity} value is not caught at compile time.
   *
   * @default 'minor'
   */
  readonly granularity?: string;

  /**
   * How often the updater checks for newer releases. Ignored when `granularity` is `'pinned'`,
   * because the schedule is not created then.
   *
   * @default Duration.hours(6)
   */
  readonly updateInterval?: Duration;
}

/**
 * An artifact resolver that also keeps the deployed Mailbox up to date. Pass it as
 * `MailboxProps.artifactResolver`.
 *
 * Artifact lookups (`resolve`, `getUrl`, `getArn`, `getVersion`) are answered by the pinned
 * resolver built from the artifact versions shipped with the package. In addition the construct
 * provisions an artifact-updater Lambda that finds this stack's tagged Lambdas, UI distributions
 * and edge function and moves them to newer releases of `distTag`, within the bounds of
 * `granularity`.
 *
 * Unless `granularity` is `'pinned'`, the updater runs after each deploy and on a schedule. The
 * updater Lambda exists in every mode, so it can also be invoked from the admin API: pass this
 * construct in `MailboxProps.adminApiAddonProviders` to expose that.
 */
export class AutoUpdater extends Construct implements IArtifactResolver, IAdminApiAddonProvider, iam.IGrantable {
  /**
   * The IAM principal of the updater Lambda's role. The updater writes to resources it does not
   * create, such as a UI bucket; grant this principal on the target resource itself, scoped to
   * that resource's own ARN.
   *
   * Do not scope such a grant by tag: for S3 object writes `aws:ResourceTag` reads the
   * still-untagged object at write time, and `s3:BucketTag` is not honored for `PutObject` even
   * though it is listed as a supported condition key on the S3 `object` resource type.
   */
  public readonly grantPrincipal: iam.IPrincipal;

  /**
   * The artifact registry location (bucket base and project) this resolver reads from, taken
   * from the pinned resolver it delegates to. Pass it to anything that must read from the same
   * registry as the rest of the Mailbox.
   */
  public readonly location: RegistryLocation;

  private readonly pinned: IArtifactResolver;
  private readonly updaterFunction: lambda.IFunction;
  private readonly trackedTriggers: TrackedUpdateTriggers;

  constructor(scope: Construct, id: string, props: AutoUpdaterProps = {}) {
    super(scope, id);
    this.pinned   = MailboxArtifactResolverFactory.fromContext(this, loadMailboxRegistryRecord(), loadMailboxArtifactVersions());
    this.location = this.pinned.location;

    // cast: the prop is a string so that a CloudFormation parameter token is accepted.
    const granularity = (props.granularity ?? 'minor') as Granularity;

    // False for 'pinned': the tracked triggers are then not created, while the updater Lambda stays.
    const isTracking = new cdk.CfnCondition(this, 'IsTracking', {
      expression: Fn.conditionNot(Fn.conditionEquals(granularity, 'pinned')),
    });

    // The updater Lambda exists under 'pinned' too, so it stays invocable from the admin API.
    const updater        = new ArtifactUpdaterLambda(this, 'artifact-updater', {
      artifactResolver: this.pinned,
      artifactBucketBase: this.location.bucketBase,
      distTag: props.distTag ?? 'stable',
      granularity,
      rootStackTagValue: Aws.STACK_NAME,
      rootStackId: StackIdentity.guid,
      updateInterval: props.updateInterval ?? Duration.hours(6),
      isTracking,
    });
    this.updaterFunction = updater;
    this.grantPrincipal  = updater.grantPrincipal;
    this.excludeFromAutoUpdate(updater);

    this.trackedTriggers = new TrackedUpdateTriggers(this, 'tracked-update-triggers', {
      updater,
      isTracking,
    });
  }

  /**
   * Resolves an artifact object to its bucket, key and version, as the pinned resolver does.
   *
   * @param packageName The registry package that publishes the artifact.
   * @param objectPath The object's path within that package.
   */
  resolve(packageName: string, objectPath: string): ResolvedArtifact {
    return this.pinned.resolve(packageName, objectPath);
  }

  /**
   * Returns the HTTPS URL of an artifact object, as the pinned resolver does.
   *
   * @param packageName The registry package that publishes the artifact.
   * @param objectPath The object's path within that package.
   */
  getUrl(packageName: string, objectPath: string): string {
    return this.pinned.getUrl(packageName, objectPath);
  }

  /**
   * Returns the S3 ARN of an artifact object, for IAM policies that must reach it, as the pinned
   * resolver does.
   *
   * @param packageName The registry package that publishes the artifact.
   * @param objectPath The object's path within that package.
   */
  getArn(packageName: string, objectPath: string): string {
    return this.pinned.getArn(packageName, objectPath);
  }

  /**
   * Returns the version a package resolves to, as the pinned resolver does.
   *
   * @param packageName The registry package whose version is requested.
   */
  getVersion(packageName: string): string {
    return this.pinned.getVersion(packageName);
  }

  /**
   * Returns the admin API addon backed by the updater Lambda, which lets the updater be invoked
   * from the admin API. It is only included in the Mailbox when this construct is listed in
   * `MailboxProps.adminApiAddonProviders`.
   *
   * @param _scope Unused: the addon is not parented under the scope.
   * @param _ctx Unused: the addon needs nothing from the shared context.
   */
  createAdminApiAddons(_scope: Construct, _ctx: AdminApiAddonContext): IAdminApiAddon[] {
    return [new ArtifactUpdaterAddon(this.updaterFunction)];
  }

  /**
   * Makes the post-deploy update trigger wait until `dependency` and its whole subtree have
   * finished deploying, for example a sub-stack or resource group the updater would otherwise
   * scan too early. Call it once per dependency.
   *
   * The trigger exists only when `granularity` is not `'pinned'`.
   *
   * @param dependency The construct whose deployment must complete before the trigger fires.
   */
  addDeployEndDependency(dependency: IConstruct): void {
    this.trackedTriggers.waitFor(dependency);
  }

  private excludeFromAutoUpdate(updater: lambda.IFunction): void {
    Tags.of(updater).add(ServerlessInboxTagKeys.autoUpdateType, 'none');
  }
}
