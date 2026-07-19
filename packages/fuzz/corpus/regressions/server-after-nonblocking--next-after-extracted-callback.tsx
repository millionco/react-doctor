// rule: server-after-nonblocking
// weakness: alias-guard
// source: PR #1317 adversarial validation

"use server";

import { after } from "next/server";

const reportSaved = (): void => {
  analytics.track("saved");
};

const saveRecord = async (): Promise<void> => {
  after(reportSaved);
};
