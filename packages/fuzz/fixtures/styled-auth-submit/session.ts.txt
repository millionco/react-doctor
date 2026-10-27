import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";

initializeApp({ projectId: "synthetic-project", apiKey: "public-placeholder" });
export const session = getAuth();
