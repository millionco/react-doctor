// rule: artifact-env-leak
/**
 * const prisma = new PrismaClient({
 *   adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL })
 * })
 */
export const PrismaClient = class {};
