interface StronglyConnectedComponentFrame {
  nodeIndex: number;
  successorIndex: number;
}

interface StronglyConnectedComponentState {
  nodeIndices: Array<number | undefined>;
  lowLinks: number[];
  nodesOnStack: boolean[];
  componentStack: number[];
  components: number[][];
  nextNodeIndex: number;
}

const popStronglyConnectedComponent = (
  currentNodeIndex: number,
  componentStack: number[],
  nodesOnStack: boolean[],
): number[] => {
  const component: number[] = [];
  let componentNodeIndex: number | undefined;
  do {
    componentNodeIndex = componentStack.pop();
    if (componentNodeIndex === undefined) {
      throw new Error("Strongly connected component stack was unexpectedly empty.");
    }
    nodesOnStack[componentNodeIndex] = false;
    component.push(componentNodeIndex);
  } while (componentNodeIndex !== currentNodeIndex);
  return component;
};

const discoverNode = (nodeIndex: number, state: StronglyConnectedComponentState): void => {
  state.nodeIndices[nodeIndex] = state.nextNodeIndex;
  state.lowLinks[nodeIndex] = state.nextNodeIndex;
  state.nextNodeIndex++;
  state.nodesOnStack[nodeIndex] = true;
  state.componentStack.push(nodeIndex);
};

const traverseStronglyConnectedComponent = (
  startNodeIndex: number,
  adjacencyList: ReadonlyArray<ReadonlyArray<number>>,
  state: StronglyConnectedComponentState,
): void => {
  discoverNode(startNodeIndex, state);
  const traversalStack: StronglyConnectedComponentFrame[] = [
    { nodeIndex: startNodeIndex, successorIndex: 0 },
  ];

  while (traversalStack.length > 0) {
    const frame = traversalStack[traversalStack.length - 1];
    const successors = adjacencyList[frame.nodeIndex];

    if (frame.successorIndex < successors.length) {
      const successorNodeIndex = successors[frame.successorIndex];
      frame.successorIndex++;
      const successorTraversalIndex = state.nodeIndices[successorNodeIndex];

      if (successorTraversalIndex === undefined) {
        discoverNode(successorNodeIndex, state);
        traversalStack.push({ nodeIndex: successorNodeIndex, successorIndex: 0 });
      } else if (state.nodesOnStack[successorNodeIndex]) {
        state.lowLinks[frame.nodeIndex] = Math.min(
          state.lowLinks[frame.nodeIndex],
          successorTraversalIndex,
        );
      }
      continue;
    }

    const currentNodeIndex = frame.nodeIndex;
    const currentTraversalIndex = state.nodeIndices[currentNodeIndex];
    traversalStack.pop();

    if (traversalStack.length > 0) {
      const parentFrame = traversalStack[traversalStack.length - 1];
      state.lowLinks[parentFrame.nodeIndex] = Math.min(
        state.lowLinks[parentFrame.nodeIndex],
        state.lowLinks[currentNodeIndex],
      );
    }

    if (currentTraversalIndex !== state.lowLinks[currentNodeIndex]) continue;
    state.components.push(
      popStronglyConnectedComponent(currentNodeIndex, state.componentStack, state.nodesOnStack),
    );
  }
};

export const findStronglyConnectedComponents = (
  adjacencyList: ReadonlyArray<ReadonlyArray<number>>,
): number[][] => {
  const state: StronglyConnectedComponentState = {
    nodeIndices: new Array(adjacencyList.length),
    lowLinks: new Array(adjacencyList.length).fill(0),
    nodesOnStack: new Array(adjacencyList.length).fill(false),
    componentStack: [],
    components: [],
    nextNodeIndex: 0,
  };

  for (let startNodeIndex = 0; startNodeIndex < adjacencyList.length; startNodeIndex++) {
    if (state.nodeIndices[startNodeIndex] !== undefined) continue;
    traverseStronglyConnectedComponent(startNodeIndex, adjacencyList, state);
  }

  return state.components;
};
