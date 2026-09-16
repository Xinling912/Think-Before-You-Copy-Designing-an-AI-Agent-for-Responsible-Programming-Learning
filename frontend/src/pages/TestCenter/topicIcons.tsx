import {
  ApartmentOutlined,
  AppstoreOutlined,
  BranchesOutlined,
  BugOutlined,
  CalculatorOutlined,
  CloudOutlined,
  CodeOutlined,
  DatabaseOutlined,
  DeploymentUnitOutlined,
  EditOutlined,
  FileTextOutlined,
  FilterOutlined,
  FontSizeOutlined,
  FunctionOutlined,
  KeyOutlined,
  NumberOutlined,
  ReloadOutlined,
  SafetyCertificateOutlined,
  SwapOutlined,
  UnorderedListOutlined,
} from '@ant-design/icons';
import type { TestIconKey } from './model';

type TopicIconComponent = typeof CodeOutlined;

export const topicIconByKey: Record<TestIconKey, TopicIconComponent> = {
  CodeOutlined,
  EditOutlined,
  DatabaseOutlined,
  CalculatorOutlined,
  FontSizeOutlined,
  UnorderedListOutlined,
  KeyOutlined,
  NumberOutlined,
  BranchesOutlined,
  ReloadOutlined,
  FilterOutlined,
  FunctionOutlined,
  SwapOutlined,
  AppstoreOutlined,
  BugOutlined,
  FileTextOutlined,
  ApartmentOutlined,
  DeploymentUnitOutlined,
  SafetyCertificateOutlined,
  CloudOutlined,
};

export function topicIconForKey(key: string): TopicIconComponent {
  const TopicIcon = topicIconByKey[key as TestIconKey];
  if (!TopicIcon) {
    throw new Error(`Unsupported test topic icon: ${key}`);
  }
  return TopicIcon;
}
