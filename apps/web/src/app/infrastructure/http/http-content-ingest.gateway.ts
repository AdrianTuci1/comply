import { Injectable } from '@angular/core';
import {
  ContentIngestGateway,
  IngestJob,
  IngestSchedule,
} from '../../application/ports/content-ingest.gateway';
import { apiUrl } from './api-url';
import { sessionHeaders } from './session-headers';

@Injectable()
export class HttpContentIngestGateway extends ContentIngestGateway {
  async start(): Promise<IngestJob> {
    const response = await fetch(apiUrl('/api/ingest'), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
        ...sessionHeaders(),
      },
      body: JSON.stringify({ framework: 'all' }),
    });
    if (!response.ok) throw new Error(`Ingest could not start (${response.status}).`);
    const payload = (await response.json()) as { job: IngestJob };
    return payload.job;
  }

  async job(id: string): Promise<IngestJob> {
    const response = await fetch(apiUrl(`/api/ingest/${encodeURIComponent(id)}`), {
      headers: { accept: 'application/json', ...sessionHeaders() },
    });
    if (!response.ok) throw new Error(`Ingest status failed (${response.status}).`);
    const payload = (await response.json()) as { job: IngestJob };
    return payload.job;
  }

  async schedule(): Promise<IngestSchedule> {
    const response = await fetch(apiUrl('/api/ingest/schedule'), {
      headers: { accept: 'application/json', ...sessionHeaders() },
    });
    if (!response.ok) throw new Error(`Refresh schedule failed (${response.status}).`);
    const payload = (await response.json()) as { schedule: IngestSchedule };
    return payload.schedule;
  }
}
