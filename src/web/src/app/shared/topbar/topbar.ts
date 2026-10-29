import {
  ChangeDetectionStrategy,
  Component,
  HostListener,
  computed,
  inject,
  signal,
} from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { OrganizationStore } from '../../application/organization.store';
import { SessionStore } from '../../application/session.store';
import { LayoutStore } from '../../layout/layout.store';
import { Avatar } from '../avatar/avatar';
import { ClickOutsideDirective } from '../click-outside.directive';
import { PLAN_LABELS } from '../i18n/labels';
import { Icon } from '../icon/icon';

@Component({
  selector: 'app-topbar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, Icon, Avatar, ClickOutsideDirective],
  templateUrl: './topbar.html',
  styleUrl: './topbar.scss',
})
export class Topbar {
  readonly organizations = inject(OrganizationStore);
  private readonly layout = inject(LayoutStore);
  private readonly sessions = inject(SessionStore);
  private readonly router = inject(Router);

  readonly mobileNavOpen = this.layout.mobileNavOpen;

  readonly orgOpen = signal(false);
  readonly userOpen = signal(false);

  readonly currentUser = computed(
    () =>
      this.sessions.user() ?? {
        name: 'Adrian Tucicov',
        email: 'adrian@comply.ro',
        organizationName: 'Nordwind Logistics',
        role: 'admin' as const,
      },
  );

  readonly planLabels = PLAN_LABELS;

  toggleOrg(): void {
    this.orgOpen.update((open) => !open);
    this.userOpen.set(false);
  }

  toggleUser(): void {
    this.userOpen.update((open) => !open);
    this.orgOpen.set(false);
  }

  selectOrganization(id: string): void {
    this.organizations.switchTo(id);
    this.orgOpen.set(false);
  }

  toggleNav(): void {
    this.layout.toggleMobileNav();
  }

  async signOut(): Promise<void> {
    this.sessions.clear();
    this.userOpen.set(false);
    await this.router.navigateByUrl('/sign-in');
  }

  @HostListener('document:keydown.escape')
  closeMenus(): void {
    this.orgOpen.set(false);
    this.userOpen.set(false);
  }
}
