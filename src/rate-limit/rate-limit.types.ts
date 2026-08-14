/** One bounded fixed-window counter. */
interface RateLimitBucket {
  readonly count: number;
  readonly windowEndsAtEpochMs: number;
}

export type { RateLimitBucket };
