// rule: async-await-in-loop
// weakness: cross-iteration-state-flow
// source: React Bench write-react-softmaple-softmaple
// verdict: pass

interface RemoteEvent {
  id: string;
}

interface RemoteOperation {
  id: string;
}

interface ApplyResult {
  operation?: RemoteOperation;
}

interface Replica {
  applyRemoteEvent: (event: RemoteEvent) => Promise<ApplyResult>;
  getText: () => string;
}

export const replayRemoteEvents = async (
  replica: Replica,
  events: RemoteEvent[],
): Promise<void> => {
  const operations: RemoteOperation[] = [];
  for (const event of events) {
    const textBefore = replica.getText();
    const result = await replica.applyRemoteEvent(event);
    const textAfter = replica.getText();
    if (result.operation) {
      operations.push(result.operation);
    } else {
      recordTextTransition(textBefore, textAfter);
    }
  }
  notifyRemoteOperations(operations);
};
