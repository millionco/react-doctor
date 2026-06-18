export interface Inner {
  id: string;
}

export type Outer = Inner[];

export type DeadDeep = Inner | null;
