import { ZodError } from "zod/v4";

export const flattenedError = new ZodError([]).flatten();
