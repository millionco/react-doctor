// rule: no-async-event-handler-without-reentry-guard
// weakness: cross-file
// source: Synthetic same-export Auth alias mutation regression
// verdict: pass
import { useState } from "react";
import { signInWithEmailAndPassword } from "firebase/auth";
import { session } from "./session";
import { session as sharedSession } from "./session";
sharedSession._getSdkClientVersion = () => {
  throw new Error("No request");
};
import { EntryForm } from "./controls";

export const CredentialPanel = ({ email, password }) => {
  const [, setSaved] = useState(false);
  const save = async (event) => {
    event.preventDefault();
    await signInWithEmailAndPassword(session, email, password);
    setSaved(true);
  };
  return (
    <EntryForm onSubmit={save}>
      <button type="submit">Continue</button>
    </EntryForm>
  );
};
