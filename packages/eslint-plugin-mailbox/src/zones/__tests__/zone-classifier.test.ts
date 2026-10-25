import { cognitoPackage, kitPackage, mailboxPackage } from '../package-roots';
import { ZoneClassifier }                             from '../zone-classifier';

const classifier = new ZoneClassifier();

describe('ZoneClassifier.locate', () => {
  it('finds the package and the path below its src folder for a repo-relative path', () => {
    expect(classifier.locate('packages/mailbox/src/core/x.ts')).toEqual({ packageRoot: mailboxPackage, rest: 'core/x' });
  });

  it('finds the package for an absolute path', () => {
    expect(classifier.locate('/home/dev/repo/packages/mailbox-cognito/src/a/b.ts')).toEqual({ packageRoot: cognitoPackage, rest: 'a/b' });
  });

  it('has no package root for a file outside every package', () => {
    expect(classifier.locate('/home/dev/other/x.ts')).toEqual({ packageRoot: null, rest: '/home/dev/other/x.ts' });
  });

  it('has no package root for a package that is not one of the three source roots', () => {
    expect(classifier.locate('packages/mailbox-addon-sdk/src/x.ts').packageRoot).toBeNull();
  });

  it('keeps the kit package root for the kit folder', () => {
    expect(classifier.locate('packages/mailbox-cdk-shared/src/x.ts').packageRoot).toBe(kitPackage);
  });
});

describe('ZoneClassifier.isExempt', () => {
  it.each([
    ['a file under __tests__', 'packages/mailbox/src/core/__tests__/x.test.ts', true],
    ['a file under runtime', 'packages/mailbox/src/runtime/x.ts', true],
    ['a file under a nested runtime folder', 'packages/mailbox/src/core/runtime/x.ts', true],
    ['a file named runtime is not exempt', 'packages/mailbox/src/core/runtime.ts', false],
  ])('%s', (_title, path, expected) => {
    expect(classifier.isExempt(classifier.locate(path))).toBe(expected);
  });
});

describe('ZoneClassifier.importerZone', () => {
  it.each([
    ['core', 'packages/mailbox/src/core/x.ts', 'core'],
    ['platform', 'packages/mailbox/src/platform/x.ts', 'platform'],
    ['a platform-only lambda', 'packages/mailbox/src/resources/lambdas/support-api-lambda.ts', 'platform-list'],
    ['a platform-only event', 'packages/mailbox/src/resources/events/stack-failed-event.ts', 'platform-list'],
    ['the sweeper workflow', 'packages/mailbox/src/resources/workflows/sweeper-workflow.ts', 'platform-list'],
    ['a resource', 'packages/mailbox/src/resources/tables/x.ts', 'resources'],
    ['a contract', 'packages/mailbox/src/contracts/x.ts', 'contracts'],
    ['a utility', 'packages/mailbox/src/utils/x.ts', 'other'],
  ])('%s is %s', (_title, path, expected) => {
    expect(classifier.importerZone(classifier.locate(path))).toBe(expected);
  });
});

describe('ZoneClassifier.targetZone', () => {
  it.each([
    ['the addons contract', 'packages/mailbox/src/core/apis/addons.ts', 'core-addons'],
    ['the auth types', 'packages/mailbox/src/core/auth/types.ts', 'core-auth-types'],
    ['other core', 'packages/mailbox/src/core/x.ts', 'core'],
    ['platform', 'packages/mailbox/src/platform/x.ts', 'platform'],
    ['a platform-only lambda', 'packages/mailbox/src/resources/lambdas/support-api-lambda.ts', 'platform-list'],
    ['a platform-only event', 'packages/mailbox/src/resources/events/stack-failed-event.ts', 'platform-list-event'],
    ['a contract resource', 'packages/mailbox/src/resources/tables/data-tables.ts', 'contract-resource'],
    ['another resource', 'packages/mailbox/src/resources/tables/other.ts', 'resources'],
    ['a contract', 'packages/mailbox/src/contracts/x.ts', 'contracts'],
    ['a utility', 'packages/mailbox/src/utils/x.ts', 'utils-runtime'],
    ['a root file', 'packages/mailbox/src/mailbox-props.ts', 'other'],
    ['a file of the kit package', 'packages/mailbox-cdk-shared/src/x.ts', 'foreign'],
  ])('%s is %s', (_title, path, expected) => {
    expect(classifier.targetZone(classifier.locate(path))).toBe(expected);
  });

  it('is foreign when there is no location at all', () => {
    expect(classifier.targetZone(null)).toBe('foreign');
  });
});

describe('ZoneClassifier.eventsRestricted', () => {
  it.each([
    ['a core file', 'packages/mailbox/src/core/x.ts', true],
    ['a platform file', 'packages/mailbox/src/platform/x.ts', true],
    ['a resource file', 'packages/mailbox/src/resources/tables/x.ts', true],
    ['a wiring file', 'packages/mailbox/src/resources/lambdas/x.ts', false],
    ['an events file', 'packages/mailbox/src/resources/events/x.ts', false],
    ['a platform-list file', 'packages/mailbox/src/resources/workflows/sweeper-workflow.ts', false],
    ['a contract file', 'packages/mailbox/src/contracts/x.ts', false],
    ['an exempt test file', 'packages/mailbox/src/core/__tests__/x.test.ts', false],
    ['a kit file', 'packages/mailbox-cdk-shared/src/x.ts', true],
    ['the kit index', 'packages/mailbox-cdk-shared/src/index.ts', false],
    ['a cognito wiring file', 'packages/mailbox-cognito/src/resources/lambdas/x.ts', false],
    ['a cognito file', 'packages/mailbox-cognito/src/x.ts', true],
  ])('%s', (_title, path, expected) => {
    expect(classifier.eventsRestricted(classifier.locate(path))).toBe(expected);
  });
});
