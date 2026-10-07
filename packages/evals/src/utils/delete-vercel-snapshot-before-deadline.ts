import { Snapshot } from "@vercel/sandbox";

import type { SandboxCredentials } from "./get-sandbox-credentials.js";

import { runBeforeDeadline } from "./run-before-deadline.js";

interface DeleteVercelSnapshotInput {
  snapshot?: Snapshot;
  credentials: SandboxCredentials;
  snapshotName: string;
  deadlineMilliseconds: number;
}

export const deleteVercelSnapshotBeforeDeadline = async ({
  snapshot,
  credentials,
  snapshotName,
  deadlineMilliseconds,
}: DeleteVercelSnapshotInput): Promise<void> => {
  await runBeforeDeadline({
    operation: async () => {
      if (snapshot) return snapshot.delete();
      const snapshots = await Snapshot.list({ ...credentials, name: snapshotName });
      for await (const remainingSnapshot of snapshots) {
        if (remainingSnapshot.status === "deleted") continue;
        const recoveredSnapshot = await Snapshot.get({
          ...credentials,
          snapshotId: remainingSnapshot.id,
        });
        await recoveredSnapshot.delete();
      }
    },
    deadlineMilliseconds,
    timeoutMessage: `Timed out deleting Vercel snapshot ${snapshot?.snapshotId ?? snapshotName}`,
  });
};
