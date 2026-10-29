import { Injectable } from '@angular/core';
import {
  AgentAssessment,
  AgentAssessmentSummary,
  AgentGateway,
} from '../../application/ports/agent-gateway';

@Injectable()
export class InMemoryAgentGateway extends AgentGateway {
  override async list(): Promise<readonly AgentAssessmentSummary[]> {
    return [];
  }

  override async get(): Promise<AgentAssessment> {
    throw new Error('Agent assessments are unavailable in the in-memory adapter.');
  }
}
