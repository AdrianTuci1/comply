import { Injectable } from '@angular/core';
import { Organization } from '../../domain/organization/organization';
import { OrganizationRepository } from '../../domain/organization/organization.repository';
import { ORGANIZATION_FIXTURES } from './fixtures/organization.fixtures';

/** Adapter seeded with fixtures; swap for an HTTP adapter behind the same port. */
@Injectable()
export class InMemoryOrganizationRepository extends OrganizationRepository {
  private readonly store = new Map<string, Organization>();

  constructor() {
    super();
    for (const fixture of ORGANIZATION_FIXTURES) {
      this.store.set(fixture.id, Organization.restore(fixture));
    }
  }

  findAll(): readonly Organization[] {
    return [...this.store.values()];
  }

  findById(id: string): Organization | undefined {
    return this.store.get(id);
  }

  save(organization: Organization): void {
    this.store.set(organization.id, organization);
  }
}
