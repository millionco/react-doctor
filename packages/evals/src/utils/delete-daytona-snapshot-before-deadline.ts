import { runBeforeDeadline } from "./run-before-deadline.js";

export interface DaytonaSnapshotClient<Snapshot> {
  get: (snapshotName: string) => Promise<Snapshot>;
  delete: (snapshot: Snapshot) => Promise<void>;
}

export const deleteDaytonaSnapshotBeforeDeadline = async <Snapshot>({
  snapshotClient,
  snapshotName,
  deadlineMilliseconds,
}: {
  snapshotClient: DaytonaSnapshotClient<Snapshot>;
  snapshotName: string;
  deadlineMilliseconds: number;
}): Promise<void> => {
  const snapshot = await runBeforeDeadline({
    operation: () => snapshotClient.get(snapshotName),
    deadlineMilliseconds,
    timeoutMessage: `Timed out recovering Daytona snapshot ${snapshotName}`,
  });
  await runBeforeDeadline({
    operation: () => snapshotClient.delete(snapshot),
    deadlineMilliseconds,
    timeoutMessage: `Timed out deleting Daytona snapshot ${snapshotName}`,
  });
};
