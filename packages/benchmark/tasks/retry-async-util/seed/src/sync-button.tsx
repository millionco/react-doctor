import { retryAsync } from "./retry-async.ts";

interface SyncButtonProps {
  sync: () => Promise<void>;
}

// Existing consumer (keeps retry-async.ts reachable). Do not edit.
export const SyncButton = ({ sync }: SyncButtonProps) => (
  <button type="button" onClick={() => void retryAsync(sync, 3)}>
    Sync
  </button>
);
