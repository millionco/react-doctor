import { db } from "./db";
export const startApp = () => db.connect();
