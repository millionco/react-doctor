export interface Parent {
  parentId: number;
}

export interface Child extends Parent {
  childId: string;
}

export interface OrphanInterface {
  legacy: boolean;
}
