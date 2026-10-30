import { Organization } from './organization';

/** Port: persistence boundary for the organization aggregate. */
export abstract class OrganizationRepository {
  abstract findAll(): readonly Organization[];
  abstract findById(id: string): Organization | undefined;
  abstract save(organization: Organization): void;
}
