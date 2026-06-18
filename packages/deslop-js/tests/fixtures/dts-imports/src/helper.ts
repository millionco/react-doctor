export interface HelperUtil {
  format: (input: string) => string;
}

export const createHelper = (): HelperUtil => ({
  format: (input: string) => input.trim(),
});
