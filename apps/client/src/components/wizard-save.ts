export type StepSaver = {
  save: () => Promise<void>;
  validate: () => Promise<boolean>;
};

export type RegisterSaver = (name: string, saver: StepSaver) => () => void;
