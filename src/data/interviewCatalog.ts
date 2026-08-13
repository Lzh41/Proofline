import { AI_INTERVIEW_CATALOG } from './interviews/aiCatalog';
import { ENGINEERING_INTERVIEW_CATALOG } from './interviews/engineeringCatalog';
import { SPECIALIZED_INTERVIEW_CATALOG } from './interviews/specializedCatalog';
import type { InterviewCatalogItem } from '../lib/interviews';

export const INTERVIEW_CATALOG_VERSION = 2;

export const MINIMUM_ROLE_COVERAGE: Record<string, number> = {
  'llm-app': 50,
  nlp: 50,
  'rag-agent': 50,
  multimodal: 50,
  'ai-platform': 50,
  'recommendation-search': 50,
  backend: 50,
  frontend: 50,
  client: 50,
  'data-engineering': 50,
  'test-development': 50,
  'sre-devops': 50,
  security: 50,
  embedded: 50,
  fundamentals: 50,
  'ai-research-training': 50,
  'computer-vision': 50,
  'data-science-quant': 50,
  'database-middleware': 50,
  'game-graphics': 50,
  'solution-architect': 50,
};

export const INTERVIEW_CATALOG: InterviewCatalogItem[] = [
  ...AI_INTERVIEW_CATALOG,
  ...ENGINEERING_INTERVIEW_CATALOG,
  ...SPECIALIZED_INTERVIEW_CATALOG,
];
