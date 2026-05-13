export type StepStats = {
  stepType: string;
  success: number;
  failed: number;
  skipped: number;
};

export type AutomationStats = {
  trigger: Record<string, number>;
  steps: Record<string, StepStats>;
};
