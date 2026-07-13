import { z } from "zod/v4";

export const emailSchema = z.string().email();
