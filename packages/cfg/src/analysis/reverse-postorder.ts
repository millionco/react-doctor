import type { BasicBlock } from "../ir/basic-block.js";

// Reverse-postorder of every block reachable from `root` over the given
// successor relation. RPO guarantees a block appears before all blocks it
// strictly dominates, which is the ordering the Cooper-Harvey-Kennedy
// dominance algorithm and forward dataflow both require. Iterative DFS so
// deep CFGs can't blow the call stack.
export const reversePostorder = (
  root: BasicBlock,
  successorsOf: (block: BasicBlock) => ReadonlyArray<BasicBlock>,
): BasicBlock[] => {
  const postorder: BasicBlock[] = [];
  const visited = new Set<BasicBlock>([root]);
  const stack: Array<{ block: BasicBlock; nextSuccessor: number }> = [
    { block: root, nextSuccessor: 0 },
  ];
  while (stack.length > 0) {
    const frame = stack[stack.length - 1]!;
    const successors = successorsOf(frame.block);
    if (frame.nextSuccessor < successors.length) {
      const next = successors[frame.nextSuccessor++]!;
      if (!visited.has(next)) {
        visited.add(next);
        stack.push({ block: next, nextSuccessor: 0 });
      }
    } else {
      postorder.push(frame.block);
      stack.pop();
    }
  }
  postorder.reverse();
  return postorder;
};
