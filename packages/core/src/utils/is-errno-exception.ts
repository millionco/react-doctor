export const isErrnoException = (
  error: unknown,
): error is NodeJS.ErrnoException & { code: string } =>
  error instanceof Error && "code" in error && typeof error.code === "string";
