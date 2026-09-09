export interface FilesystemCacheEpochGate {
  /**
   * Whether cached filesystem state must be dropped before serving a job in
   * `filesystemCacheEpoch`. Consecutive jobs of one epoch share the disk
   * view; a `null` epoch never shares.
   */
  readonly shouldReset: (filesystemCacheEpoch: number | null) => boolean;
}

export const createFilesystemCacheEpochGate = (): FilesystemCacheEpochGate => {
  let lastFilesystemCacheEpoch: number | null = null;
  return {
    shouldReset: (filesystemCacheEpoch) => {
      if (filesystemCacheEpoch !== null && filesystemCacheEpoch === lastFilesystemCacheEpoch) {
        return false;
      }
      lastFilesystemCacheEpoch = filesystemCacheEpoch;
      return true;
    },
  };
};
