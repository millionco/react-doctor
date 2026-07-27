interface StronglyConnectedComponentFrame {
  nodeIndex: number;
  successorIndex: number;
}

export const findStronglyConnectedComponents = (
  adjacencyList: ReadonlyArray<ReadonlyArray<number>>,
): number[][] => {
  const nodeIndices: Array<number | undefined> = new Array(adjacencyList.length);
  const lowLinks: number[] = new Array(adjacencyList.length).fill(0);
  const nodesOnStack: boolean[] = new Array(adjacencyList.length).fill(false);
  const componentStack: number[] = [];
  const components: number[][] = [];
  let nextNodeIndex = 0;

  for (let startNodeIndex = 0; startNodeIndex < adjacencyList.length; startNodeIndex++) {
    if (nodeIndices[startNodeIndex] !== undefined) continue;

    nodeIndices[startNodeIndex] = nextNodeIndex;
    lowLinks[startNodeIndex] = nextNodeIndex;
    nextNodeIndex++;
    nodesOnStack[startNodeIndex] = true;
    componentStack.push(startNodeIndex);

    const traversalStack: StronglyConnectedComponentFrame[] = [
      { nodeIndex: startNodeIndex, successorIndex: 0 },
    ];

    while (traversalStack.length > 0) {
      const frame = traversalStack[traversalStack.length - 1];
      const successors = adjacencyList[frame.nodeIndex];

      if (frame.successorIndex < successors.length) {
        const successorNodeIndex = successors[frame.successorIndex];
        frame.successorIndex++;
        const successorTraversalIndex = nodeIndices[successorNodeIndex];

        if (successorTraversalIndex === undefined) {
          nodeIndices[successorNodeIndex] = nextNodeIndex;
          lowLinks[successorNodeIndex] = nextNodeIndex;
          nextNodeIndex++;
          nodesOnStack[successorNodeIndex] = true;
          componentStack.push(successorNodeIndex);
          traversalStack.push({ nodeIndex: successorNodeIndex, successorIndex: 0 });
        } else if (nodesOnStack[successorNodeIndex]) {
          lowLinks[frame.nodeIndex] = Math.min(lowLinks[frame.nodeIndex], successorTraversalIndex);
        }
        continue;
      }

      const currentNodeIndex = frame.nodeIndex;
      const currentTraversalIndex = nodeIndices[currentNodeIndex];
      traversalStack.pop();

      if (traversalStack.length > 0) {
        const parentFrame = traversalStack[traversalStack.length - 1];
        lowLinks[parentFrame.nodeIndex] = Math.min(
          lowLinks[parentFrame.nodeIndex],
          lowLinks[currentNodeIndex],
        );
      }

      if (currentTraversalIndex !== lowLinks[currentNodeIndex]) continue;

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
      components.push(component);
    }
  }

  return components;
};
