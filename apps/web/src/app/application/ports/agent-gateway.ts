export type AgentPhase = 'scope' | 'collect' | 'review' | 'export' | 'complete';

export interface AgentProgress {
  total: number;
  completed: number;
  not_applicable: number;
  evidence_collected: number;
  open: number;
  evidence: number;
  percent: number;
}

export interface AgentAction {
  tool: string;
  description: string;
  arguments: Record<string, unknown>;
}

export interface AgentLanguagePolicy {
  userLanguage: string;
  publishLanguage: string;
  instruction: string;
}

export interface AgentAssessmentSummary {
  assessment_id: string;
  name: string;
  framework: string;
  phase: AgentPhase;
  scope: string;
  period: { from: string; to: string };
  progress: AgentProgress;
  updated_at: string;
}

export interface AgentEvidence {
  id: string;
  title: string;
  type: string;
  source: string;
  summary: string;
  citation: string | null;
  collectedAt: string;
  hash: string;
}

export interface AgentRequirement {
  requirement_id: string;
  ref: string;
  title: string;
  description: string;
  status: 'open' | 'evidence_collected' | 'completed' | 'not_applicable';
  evidence_count: number;
  conclusion: string | null;
  completed_at: string | null;
  evidence?: readonly AgentEvidence[];
}

export interface AgentEvent {
  at: string;
  revision: number;
  type: string;
  message: string;
}

export interface AgentAssessment {
  assessment_id: string;
  name: string;
  framework: string;
  status: AgentPhase;
  phase: AgentPhase;
  scope: string;
  period: { from: string; to: string };
  revision: number;
  updated_at: string;
  content_status: 'published' | 'extracted';
  language: string;
  events: AgentEvent[];
  items: AgentRequirement[];
  total: number;
  progress: AgentProgress;
  next_actions: AgentAction[];
  language_policy: AgentLanguagePolicy;
}

export interface AgentConnection {
  endpoint: string;
  tenant: string;
  bearer: string;
  config: string;
}

export abstract class AgentGateway {
  abstract list(tenantId: string): Promise<readonly AgentAssessmentSummary[]>;
  abstract get(tenantId: string, id: string): Promise<AgentAssessment>;
}
