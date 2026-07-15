// rule: no-pass-data-to-parent
// weakness: alias-guard
// source: ISSUES_TO_FIX_ASAP.md react-pdf Page trial pxCcHyD
import { useEffect, useRef } from "react";

interface PageProps {
  pageIndex: number;
  registerPage: (pageIndex: number, element: HTMLDivElement) => void;
}

export const Page = ({ pageIndex, registerPage }: PageProps) => {
  const pageElement = useRef<HTMLDivElement>(null);
  const registrationPropsRef = useRef({ pageIndex, registerPage });

  useEffect(() => {
    registrationPropsRef.current = { pageIndex, registerPage };
  }, [pageIndex, registerPage]);

  useEffect(() => {
    const { pageIndex: currentPageIndex, registerPage: currentRegisterPage } =
      registrationPropsRef.current;
    if (pageElement.current) currentRegisterPage(currentPageIndex, pageElement.current);
  }, [pageIndex]);

  return <div ref={pageElement} />;
};
