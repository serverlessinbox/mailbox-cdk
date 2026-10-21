const ANSWER_MARGIN_MS = 60_000;

/** The time the running Lambda invocation has left, as its context reports it. */
export interface InvocationDeadline {
  getRemainingTimeInMillis(): number;
}

/**
 * Whether the invocation has more than the minute it needs to answer CloudFormation once the unit of work in
 * hand has finished. A long-running custom resource checks this between its units of work and answers FAILED
 * when it is false, because an invocation that Lambda kills sends no answer at all.
 */
export function hasTimeLeft(deadline: InvocationDeadline): boolean {
  return deadline.getRemainingTimeInMillis() > ANSWER_MARGIN_MS;
}
