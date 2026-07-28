interface ApplicationProps {
  model: {
    revision: number;
  };
}

const updateModel = (model: ApplicationProps["model"]) => {
  const modelAlias = model;
  modelAlias.revision += 1;
};

export const Application = ({ model }: ApplicationProps) => {
  updateModel(model);
  return <main>Revision {model.revision}</main>;
};
