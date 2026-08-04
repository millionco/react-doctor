import { useEffect as scheduleEffect } from "react";

interface TitleProperties {
  title: string;
}

export const Title = ({ title }: TitleProperties) => {
  scheduleEffect(() => {
    document.title = title;
  }, []);
  return <h1>{title}</h1>;
};
