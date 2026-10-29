import { Injectable } from '@angular/core';
import { ActiveOrganizationStorage } from '../../application/ports/active-organization.storage';

const KEY = 'comply.activeOrganization';

@Injectable()
export class LocalStorageActiveOrganizationStorage extends ActiveOrganizationStorage {
  get(): string | null {
    return localStorage.getItem(KEY);
  }

  set(organizationId: string): void {
    localStorage.setItem(KEY, organizationId);
  }
}
