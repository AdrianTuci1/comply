import { Injectable, signal } from '@angular/core';

/** UI state shared by the topbar trigger and the mobile navigation drawer. */
@Injectable({ providedIn: 'root' })
export class LayoutStore {
  private readonly mobileNav = signal(false);

  readonly mobileNavOpen = this.mobileNav.asReadonly();

  toggleMobileNav(): void {
    this.mobileNav.update((open) => !open);
  }

  closeMobileNav(): void {
    this.mobileNav.set(false);
  }
}
