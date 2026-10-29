/** Port: the backend job that fetches the official documents. */
export interface IngestJob {
  id: string;
  status: 'running' | 'succeeded' | 'failed';
  framework: string;
  startedAt: string;
  finishedAt: string | null;
  error: string | null;
}

export interface IngestSchedule {
  enabled: boolean;
  intervalHours: number;
  nextRunAt: string | null;
  lastRunAt: string | null;
  lastStatus: string | null;
}

export abstract class ContentIngestGateway {
  abstract start(): Promise<IngestJob>;
  abstract job(id: string): Promise<IngestJob>;
  abstract schedule(): Promise<IngestSchedule>;
}
