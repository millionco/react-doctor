// rule: only-export-components
// weakness: framework-gating
// source: 0.8.1-to-main all-rules parity audit
// verdict: fail

interface WorkerContext {
  database: {
    items: {
      toArray: () => Promise<unknown[]>;
    };
  };
  fetchFromServer: () => Promise<Response>;
}

export const workerLoader = async ({ context }: { context: WorkerContext }) =>
  context.database.items.toArray();

export const workerAction = async ({ context }: { context: WorkerContext }) =>
  context.fetchFromServer();

export default function FlightsRoute() {
  return <div />;
}
