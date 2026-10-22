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
