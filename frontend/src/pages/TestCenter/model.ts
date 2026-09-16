export type TestIconKey =
  | 'CodeOutlined'
  | 'EditOutlined'
  | 'DatabaseOutlined'
  | 'CalculatorOutlined'
  | 'FontSizeOutlined'
  | 'UnorderedListOutlined'
  | 'KeyOutlined'
  | 'NumberOutlined'
  | 'BranchesOutlined'
  | 'ReloadOutlined'
  | 'FilterOutlined'
  | 'FunctionOutlined'
  | 'SwapOutlined'
  | 'AppstoreOutlined'
  | 'BugOutlined'
  | 'FileTextOutlined'
  | 'ApartmentOutlined'
  | 'DeploymentUnitOutlined'
  | 'SafetyCertificateOutlined'
  | 'CloudOutlined';

export type TestTopicProgress = {
  id: string;
  label: string;
  summary: string;
  icon: TestIconKey;
  score: number;
  maximum: number;
  percent: number;
};

export type TestProgress = {
  score: number;
  maximum: number;
  percent: number;
};

export type PublicTestQuestion = {
  question_id: string;
  topic_id: string;
  level: number;
  question_format: string;
  question_text: string;
  options: string[];
  progress: TestProgress;
};

export type PublicTestResult = {
  attempt_id: string;
  question_id: string;
  is_correct: boolean;
  feedback: string;
  progress: TestProgress;
  duplicate: boolean;
};
