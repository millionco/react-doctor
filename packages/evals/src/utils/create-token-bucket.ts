export interface TokenBucketOptions {
  capacity: number;
  windowMs: number;
  now?: () => number;
}

export interface TokenBucket {
  consume: (count?: number) => number;
}

export const createTokenBucket = ({
  capacity,
  windowMs,
  now = () => performance.now(),
}: TokenBucketOptions): TokenBucket => {
  if (!Number.isInteger(capacity) || capacity < 1 || !Number.isFinite(windowMs) || windowMs <= 0)
    throw new TypeError("Rate capacity and window must be positive");
  let tokens = capacity;
  let updatedAt = now();
  return {
    consume: (count = 1) => {
      if (!Number.isInteger(count) || count < 1)
        throw new TypeError("Token count must be a positive integer");
      if (count > capacity) return windowMs;
      const currentTime = now();
      tokens = Math.min(
        capacity,
        tokens + (Math.max(0, currentTime - updatedAt) * capacity) / windowMs,
      );
      updatedAt = currentTime;
      if (tokens < count) return Math.ceil(((count - tokens) * windowMs) / capacity);
      tokens -= count;
      return 0;
    },
  };
};
