// rule: server-auth-actions
// weakness: library-idiom
// source: 0.8.1-to-main all-rules parity (inifarhan/skaters, Vette1123/movies-streaming-platform)
// verdict: pass
"use server";

export const searchProducts = async (query: string) =>
  prisma.product.findMany({ where: { name: { contains: query } } });
