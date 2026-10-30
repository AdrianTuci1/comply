/** Port: remembers which organization the user last worked in. */
export abstract class ActiveOrganizationStorage {
  abstract get(): string | null;
  abstract set(organizationId: string): void;
}
