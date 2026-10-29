import { Injectable } from '@angular/core';
import {
  ContentIngestGateway,
  IngestJob,
  IngestSchedule,
} from '../../application/ports/content-ingest.gateway';

/** Tests can bind this gateway; it never reaches the network. */
@Injectable()
export class InMemoryContentIngestGateway extends ContentIngestGateway {
  async start(): Promise<IngestJob> {
    throw new Error('Document refresh is not available in memory.');
  }

  async job(): Promise<IngestJob> {
    throw new Error('Document refresh is not available in memory.');
  }

  async schedule(): Promise<IngestSchedule> {
    return {
      enabled: false,
      intervalHours: 0,
      nextRunAt: null,
      lastRunAt: null,
      lastStatus: null,
    };
  }
}
