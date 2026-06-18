export interface UsedType {
  id: string;
  name: string;
}

export interface UnusedType {
  legacyId: number;
  legacyLabel: string;
}

export type UsedAlias = string | number;

export type UnusedAlias = boolean | null;
