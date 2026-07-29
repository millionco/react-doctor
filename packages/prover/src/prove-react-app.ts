import * as path from "node:path";
import {
  FIRST_SOURCE_COLUMN,
  FIRST_SOURCE_LINE,
  REACT_COMPILER_FACT_PHASE,
  REACT_COMPILER_VERSION,
  REACT_PROOF_SCHEMA_VERSION,
  REACT_SEMANTIC_GRAPH_SCHEMA_VERSION,
} from "./constants.js";
import { createTypeScriptProject } from "./create-typescript-project.js";
import { proveReactProgram } from "./prove-react-program.js";
import { ReactAppProofStatus, ReactCompilerFactStatus } from "./types.js";
import type { ProveReactAppInput, ReactAppProofReport } from "./types.js";

export const proveReactApp = (input: ProveReactAppInput): ReactAppProofReport => {
  const rootDirectory = path.resolve(input.rootDirectory);
  const project = createTypeScriptProject(rootDirectory, input.tsconfigPath);
  if (project.program) {
    return proveReactProgram(project.program, rootDirectory, project.evidence);
  }
  return {
    schemaVersion: REACT_PROOF_SCHEMA_VERSION,
    status: ReactAppProofStatus.Incomplete,
    rootDirectory,
    graph: {
      schemaVersion: REACT_SEMANTIC_GRAPH_SCHEMA_VERSION,
      actionStates: [],
      actionStateDispatches: [],
      units: [],
      edges: [],
      hookCalls: [],
      effects: [],
      effectEvents: [],
      externalStores: [],
      asyncTasks: [],
      contexts: [],
      contextProviders: [],
      contextConsumers: [],
      errorBoundaryDefinitions: [],
      errorBoundaries: [],
      renderFailures: [],
      useResources: [],
      hostControls: [],
      suspenseBoundaries: [],
      lazyComponents: [],
      lazyRenders: [],
      renders: [],
      slotFlows: [],
      callbacks: [],
      reachableFunctions: [],
      functionCalls: [],
      eventBindings: [],
      callbackPropFlows: [],
      callableRefs: [],
      imperativeHandles: [],
      imperativeHandleMethods: [],
      imperativeHandleBindings: [],
      imperativeHandleInvocations: [],
      schedulers: [],
      resources: [],
      classConstructions: [],
      classLifecycles: [],
      classStateWrites: [],
      classStateTransitions: [],
      formActions: [],
      forms: [],
      formStatuses: [],
      hookStateTransitions: [],
      reducers: [],
      reducerDispatches: [],
      optimisticStates: [],
      optimisticUpdates: [],
      transitionActions: [],
      compiler: {
        version: REACT_COMPILER_VERSION,
        phase: REACT_COMPILER_FACT_PHASE,
        status: ReactCompilerFactStatus.Incomplete,
        functions: [],
        failures: [],
      },
    },
    units: [],
    projectEvidence:
      project.evidence.length > 0
        ? project.evidence
        : [
            {
              description: "The TypeScript program could not be constructed",
              location: {
                filePath: "tsconfig.json",
                line: FIRST_SOURCE_LINE,
                column: FIRST_SOURCE_COLUMN,
              },
              trace: ["project", "TypeScript program", "React proof"],
            },
          ],
    summary: {
      files: 0,
      units: 0,
      proved: 0,
      violated: 0,
      unknown: 0,
    },
  };
};
