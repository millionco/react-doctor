import { defineCollection, z } from "astro:content";
export const collections = { blog: defineCollection({ schema: z.object({}) }) };
