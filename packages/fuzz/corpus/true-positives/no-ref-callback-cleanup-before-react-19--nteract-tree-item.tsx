// rule: no-ref-callback-cleanup-before-react-19
// weakness: version-sensitive-runtime-contract
// source: React Bench fix-react-rdh-nteract-semiotic-a__w46E9ox

interface TreeItemProps {
  itemRefs: { current: Map<string, HTMLLIElement> };
  nodeId: string;
}

export const TreeItem = ({ itemRefs, nodeId }: TreeItemProps) => (
  <li
    ref={(element) => {
      if (element) itemRefs.current.set(nodeId, element);
      return () => {
        itemRefs.current.delete(nodeId);
      };
    }}
  />
);
