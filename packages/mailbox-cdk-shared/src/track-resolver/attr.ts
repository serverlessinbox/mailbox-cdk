/**
 * TrackResolver CloudFormation attribute constant (SDK-free).
 *
 * Isolated into its own module with NO external dependencies so it can be safely imported by
 * construct/provider code at ts-node synth time. The handler (handler.ts) imports this when it
 * needs to write the version attribute; the barrel and provider code import from here, not from
 * the handler. Keeps the AWS SDK dependency (used only by handler.ts) OUT of the construct import
 * graph.
 */

/** Attribute name for the resolved version in CloudFormation GetAtt. */
export const TRACK_RESOLVER_VERSION_ATTR = 'Version';
