"use client";

import { useEffect, useState } from "react";
import Head from "next/head";
import { redirect } from "next/navigation";

const useSearchParams = () => new URLSearchParams();

const Page = () => {
  const params = useSearchParams();

  useEffect(() => {
    fetch("/api/data");
  }, []);

  useEffect(() => {
    router.push("/dashboard");
  }, []);

  return (
    <div>
      <img src="/photo.jpg" alt="photo" />
      <a href="/about">About</a>
      <Image fill src="/hero.jpg" alt="hero" />
      <script src="https://cdn.example.com/analytics.js" />
      <Script>{`console.log("inline")`}</Script>
      <Script src="https://cdn.polyfill.io/v3/polyfill.min.js" />
      <link href="https://fonts.googleapis.com/css2?family=Inter" rel="stylesheet" />
      <link rel="stylesheet" href="/styles/main.css" />
    </div>
  );
};

const AsyncClientComponent = async () => {
  const data = await fetch("/api/data");
  return <div>{JSON.stringify(data)}</div>;
};

const RedirectInTryCatchComponent = () => {
  try {
    redirect("/dashboard");
  } catch {
    return <div>error</div>;
  }
  return <div />;
};

const router = { push: (_path: string) => {} };
const Image = (props: any) => <img {...props} />;
const Script = (props: any) => <script {...props} />;

export default Page;
export { AsyncClientComponent, RedirectInTryCatchComponent };
