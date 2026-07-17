// rule: server-after-nonblocking
// weakness: library-idiom
// source: issue #1313

"use server";

import { after } from "next/server";

const saveUpload = async (): Promise<void> => {
  after(() => console.info(JSON.stringify({ event: "upload_ok" })));
};
