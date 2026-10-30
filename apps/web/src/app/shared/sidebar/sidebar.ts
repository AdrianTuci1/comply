import { ChangeDetectionStrategy, Component, HostListener, computed, inject } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { ComplianceFacade } from '../../application/compliance.facade';
import { OrganizationStore } from '../../application/organization.store';
import { LayoutStore } from '../../layout/layout.store';
import { PLAN_LABELS } from '../i18n/labels';
import { Icon } from '../icon/icon';

@Component({
  selector: 'app-sidebar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, RouterLinkActive, Icon],
  templateUrl: './sidebar.html',
  styleUrl: './sidebar.scss',
})
export class Sidebar {
  private readonly compliance = inject(ComplianceFacade);
  private readonly organizations = inject(OrganizationStore);
  private readonly layout = inject(LayoutStore);

  readonly mobileOpen = this.layout.mobileNavOpen;

  readonly planLabel = computed(() => PLAN_LABELS[this.organizations.active().plan]);

  readonly boardCount = computed(
    () => this.compliance.boardsOf(this.organizations.activeId()).length,
  );

  readonly boardLimit = computed(() => {
    switch (this.organizations.active().plan) {
      case 'free':
        return 1;
      case 'team':
        return 10;
      default:
        return 50;
    }
  });

  readonly usage = computed(() =>
    Math.min(100, Math.round((this.boardCount() / this.boardLimit()) * 100)),
  );

  closeMobileNav(): void {
    this.layout.closeMobileNav();
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    this.layout.closeMobileNav();
  }
}
