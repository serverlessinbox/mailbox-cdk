import { createHash } from 'crypto';
import { GetHostedZoneCommand, type Route53Client } from '@aws-sdk/client-route-53';
import { sanitizeStackName } from '../../naming/sanitize-name';
import type { StackId } from '../shared/custom-resource-identifiers';
import { ExpectedFailure } from '../shared/expected-failure';
import type { LoggerBuffer } from '../shared/logger-buffer';
import { isStackHelpersResourceProperties, type StackHelpersResourceProperties } from './resource-properties';

const MAX_S3_SAFE_STACK_NAME_LENGTH = 40;
const TRAILING_DOT = /\.$/;

const NON_ALPHANUMERIC = /[^a-z0-9]/g;
const HYPHEN_RUN = /-+/g;
const COGNITO_RESERVED_WORDS = /aws|amazon|cognito/g;
const EDGE_HYPHENS = /^-+|-+$/g;
const TRAILING_HYPHENS = /-+$/;
const MAX_COGNITO_PREFIX_LENGTH = 63;
const LAST_RESORT_COGNITO_PREFIX = 'installer';
const HOURS_PER_DAY = 24;
const MINUTES_PER_HOUR = 60;

/**
 * The attributes of a `Custom::StackHelpers` resource. A type alias, not an interface: `wrapHandler`
 * only accepts a response `Data` assignable to `Record<string, string>`, which an interface is not.
 */
export type StackHelpersData = {
  readonly domainName: string;
  readonly s3SafeDataStackName: string;
  readonly cognitoDomainPrefix: string;
  readonly dailyScheduleHour: string;
  readonly dailyScheduleMinute: string;
};

/** The time of day, in UTC, derived for one stack. */
type DailySchedule = Pick<StackHelpersData, 'dailyScheduleHour' | 'dailyScheduleMinute'>;

/**
 * Derives the attributes of a `Custom::StackHelpers` resource from its properties. Delete handling
 * and the CloudFormation response are not its concern.
 */
export class StackHelpersResolver {
  private readonly route53: Route53Client;
  private readonly logger: LoggerBuffer;

  constructor(route53: Route53Client, logger: LoggerBuffer) {
    this.route53 = route53;
    this.logger = logger;
  }

  /** Rejects properties of the wrong shape with an `ExpectedFailure`; a Route 53 failure reaches the caller unchanged. */
  async resolve(resourceProperties: unknown, stackId: StackId): Promise<StackHelpersData> {
    const properties = this.parseProperties(resourceProperties);

    const domainName = await this.lookUpDomainName(properties.HostedZoneId ?? '');
    const s3SafeDataStackName = this.sanitizeDataStackName(properties.DataStackName ?? '');
    const prefixFallback = properties.Fallback || s3SafeDataStackName;
    const cognitoDomainPrefix = this.deriveCognitoDomainPrefix(domainName, prefixFallback);
    const dailySchedule = this.deriveDailySchedule(stackId);

    return { domainName, s3SafeDataStackName, cognitoDomainPrefix, ...dailySchedule };
  }

  private parseProperties(resourceProperties: unknown): StackHelpersResourceProperties {
    const errors: string[] = [];
    if (!isStackHelpersResourceProperties(resourceProperties, { errors })) {
      throw new ExpectedFailure(`Invalid ResourceProperties: ${errors.join('; ')}`);
    }
    return resourceProperties;
  }

  private async lookUpDomainName(hostedZoneId: string): Promise<string> {
    if (hostedZoneId === '') {
      return '';
    }

    this.logger.debug('stack_helpers_looking_up_hosted_zone', { hostedZoneId });
    const response = await this.route53.send(new GetHostedZoneCommand({ Id: hostedZoneId }));
    return (response.HostedZone?.Name ?? '').replace(TRAILING_DOT, '');
  }

  private sanitizeDataStackName(dataStackName: string): string {
    return sanitizeStackName(dataStackName).slice(0, MAX_S3_SAFE_STACK_NAME_LENGTH);
  }

  /** Falls back to `fallback` when the domain name leaves nothing usable, then to `installer`. */
  private deriveCognitoDomainPrefix(domainName: string, fallback: string): string {
    const fromDomainName = this.normalizeForCognito(domainName);
    if (fromDomainName !== '') {
      return fromDomainName;
    }

    const fromFallback = this.normalizeForCognito(fallback);
    return fromFallback !== '' ? fromFallback : LAST_RESORT_COGNITO_PREFIX;
  }

  private normalizeForCognito(value: string): string {
    return value
      .toLowerCase()
      .replace(NON_ALPHANUMERIC, '-')
      .replace(HYPHEN_RUN, '-')
      .replace(COGNITO_RESERVED_WORDS, '-')
      .replace(HYPHEN_RUN, '-')
      .replace(EDGE_HYPHENS, '')
      .slice(0, MAX_COGNITO_PREFIX_LENGTH)
      .replace(TRAILING_HYPHENS, '');
  }

  /** The stack id never changes during the life of a stack, so a stack keeps its time across updates. */
  private deriveDailySchedule(stackId: StackId): DailySchedule {
    const digest = createHash('sha256').update(stackId).digest();
    return {
      dailyScheduleHour: String(digest.readUInt32BE(0) % HOURS_PER_DAY),
      dailyScheduleMinute: String(digest.readUInt32BE(4) % MINUTES_PER_HOUR),
    };
  }
}
