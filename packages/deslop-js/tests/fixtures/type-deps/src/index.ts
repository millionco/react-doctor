import type { ZodSchema } from "zod";
import express from "express";

const app = express();

export const validate = (schema: ZodSchema) => schema;
export const server = app;
