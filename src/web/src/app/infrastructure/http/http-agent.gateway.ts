import { Injectable } from '@angular/core';
import {
  AgentAssessment,
  AgentAssessmentSummary,
  AgentGateway,
} from '../../application/ports/agent-gateway';

interface ListPayload {
  assessments?: AgentAssessmentSummary[];
}

@Injectable()
export class HttpAgentGateway extends AgentGateway {
  override async list(tenantId: string): Promise<readonly AgentAssessmentSummary[]> {
    const response = await fetch('/api/agent/assessments', {
      headers: { accept: 'application/json', 'x-comply-tenant': tenantId },
    });
    if (!response.ok) throw new Error(`Assessments request failed with ${response.status}.`);
    const payload = (await response.json()) as ListPayload;
    return payload.assessments ?? [];
  }

  override async get(tenantId: string, id: string): Promise<AgentAssessment> {
    const response = await fetch(`/api/agent/assessments/${encodeURIComponent(id)}`, {
      headers: { accept: 'application/json', 'x-comply-tenant': tenantId },
    });
    if (!response.ok) {
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      throw new Error(payload.error ?? `Assessment request failed with ${response.status}.`);
    }
    return (await response.json()) as AgentAssessment;
  }
}
