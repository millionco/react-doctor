declare const readExperimentAssignment: () => string;

export const Experiment = () => {
  const assignment = readExperimentAssignment();
  return <p>{assignment}</p>;
};
