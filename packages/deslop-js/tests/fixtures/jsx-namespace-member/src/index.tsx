import * as S from "./style";

export const App = () => {
  const label = S.helper();
  return (
    <div title={label}>
      <S.Custom />
    </div>
  );
};
