export interface PackageJson {
  name: string;
}

export interface EditStatus {
  ok: boolean;
}

export const runEdit = (status: EditStatus): boolean => status.ok;
export const helperOne = (): string => "one";
export const helperTwo = (): string => "two";
