import { useEffect } from "react";

interface DocumentTitleProperties {
  title: string;
}

export const DocumentTitle = ({ title }: DocumentTitleProperties) => {
  useEffect(() => {
    document.title = title;
  }, []);
  return <h1>{title}</h1>;
};
