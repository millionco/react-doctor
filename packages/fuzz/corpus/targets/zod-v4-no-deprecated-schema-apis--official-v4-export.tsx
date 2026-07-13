import { z } from "zod/v4";

export const strictSchema = z.object({ value: z.string() }).strict();
