import type { UpdateCycle } from '../update-cycle';

/** Builds the update cycle of the invocation; it throws the configuration error when the configuration failed to load. */
export type NewUpdateCycle = () => UpdateCycle;

/**
 * One way the updater is started. The handler detects which trigger an event belongs to, lets it handle the
 * event, and answers a failure through the same trigger, so each trigger owns what its caller expects back.
 */
export interface UpdaterTrigger<Answer> {
  /** Handles the event this trigger was built for. Throws what the work throws. */
  handle(): Promise<Answer>;

  /** The answer for a failure thrown from `handle`; a trigger whose caller must see the failure throws it. */
  answerFailure(failure: unknown): Answer;
}
