"use client";

import { useEffect } from "react";

const router = {
  replace: (_path: string) => {},
};

const PagesRouterApp = () => {
  useEffect(() => {
    router.replace("/login");
  }, []);

  return null;
};

export default PagesRouterApp;
