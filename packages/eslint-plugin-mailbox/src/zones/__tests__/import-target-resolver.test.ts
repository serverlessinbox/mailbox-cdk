import { ImportTargetResolver }  from '../import-target-resolver';
import { mailboxPackage }        from '../package-roots';
import { ZoneClassifier }        from '../zone-classifier';

const resolver = new ImportTargetResolver(new ZoneClassifier());

describe('ImportTargetResolver.resolve', () => {
  it('resolves a relative specifier against the importing file', () => {
    expect(resolver.resolve('../platform/x', 'packages/mailbox/src/core/a.ts')).toEqual({
      relative: true,
      location: { packageRoot: mailboxPackage, rest: 'platform/x' },
    });
  });

  it('resolves a sibling specifier', () => {
    expect(resolver.resolve('./b', 'packages/mailbox/src/core/a.ts')).toEqual({
      relative: true,
      location: { packageRoot: mailboxPackage, rest: 'core/b' },
    });
  });

  it('maps a package-name subpath onto the package src folder', () => {
    expect(resolver.resolve('@serverlessinbox/mailbox/core/x', 'packages/mailbox-cognito/src/a.ts')).toEqual({
      relative: false,
      location: { packageRoot: mailboxPackage, rest: 'core/x' },
    });
  });

  it('maps a bare package name onto its index', () => {
    expect(resolver.resolve('@serverlessinbox/mailbox', 'packages/mailbox-cdk-shared/src/a.ts')).toEqual({
      relative: false,
      location: { packageRoot: mailboxPackage, rest: 'index' },
    });
  });

  it('does not treat a longer package name as a subpath of a known one', () => {
    expect(resolver.resolve('@serverlessinbox/mailboxx/core/x', 'packages/mailbox/src/a.ts')).toEqual({ relative: false, location: null });
  });

  it('has no location for an external package', () => {
    expect(resolver.resolve('aws-cdk-lib/aws-iam', 'packages/mailbox/src/a.ts')).toEqual({ relative: false, location: null });
  });
});
