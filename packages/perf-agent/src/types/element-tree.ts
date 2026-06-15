export interface DevtoolsElementTreeNode {
  id: number;
  parentID: number;
  type: number;
  displayName: string | null;
  hocDisplayNames: Array<string> | null;
  key: number | string | null;
  compiledWithForget: boolean;
  children: Array<number>;
}

export type DevtoolsElementTree = Map<number, DevtoolsElementTreeNode>;
