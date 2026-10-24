/**
 * How the artifact updater follows new releases.
 *
 * For `MAJOR` and `MINOR` the updater reads the release pointer of the track derived from a
 * deployed artifact's version, for the configured dist-tag, and moves the artifact only to a
 * strictly newer version on that track.
 */
export enum Granularity {
  /**
   * The updater derives the release track from the major number of a deployed artifact's version
   * (`1.4.2` follows track `v1`) and moves the artifact to any strictly newer version on that
   * track, so new minor releases are adopted automatically.
   */
  MAJOR = 'major',

  /**
   * The updater derives the track from the major and minor numbers (`1.4.2` follows track
   * `v1.4`), so only patch releases are adopted automatically. This is the default of
   * {@link AutoUpdaterProps.granularity}.
   */
  MINOR = 'minor',

  /**
   * Automatic updates are off. The post-deploy trigger and the schedule are not created and the
   * deployed artifacts change only when you deploy a new template or invoke the updater from the
   * admin API.
   */
  PINNED = 'pinned',
}
