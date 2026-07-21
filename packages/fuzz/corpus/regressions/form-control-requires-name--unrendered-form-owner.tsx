// rule: form-control-requires-name
// verdict: pass
// weakness: control-flow

export const DetachedField = () => {
  const unusedForm = <form id="profile" />;
  return <input form="profile" />;
};
