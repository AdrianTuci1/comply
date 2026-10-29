import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { Sidebar } from '../shared/sidebar/sidebar';
import { Topbar } from '../shared/topbar/topbar';

@Component({
  selector: 'app-shell',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterOutlet, Topbar, Sidebar],
  template: `
    <a class="skip" href="#main">Skip to content</a>
    <app-topbar />
    <div class="shell">
      <app-sidebar />
      <main id="main" class="content">
        <router-outlet />
      </main>
    </div>
  `,
  styles: `
    :host {
      display: block;
      min-height: 100vh;
      background: var(--bg);
    }

    .shell {
      display: grid;
      grid-template-columns: var(--sidebar-width) minmax(0, 1fr);
      align-items: start;
    }

    .content {
      min-width: 0;
      width: 100%;
      max-width: 1360px;
      padding: 30px 34px 72px;
    }

    .skip {
      position: absolute;
      left: -9999px;
      top: 8px;
      padding: 8px 12px;
      background: #101828;
      color: #fff;
      border-radius: 8px;
      z-index: 100;
      font-size: 13px;
      text-decoration: none;
    }

    .skip:focus {
      left: 12px;
    }

    @media (max-width: 900px) {
      .shell {
        grid-template-columns: minmax(0, 1fr);
      }

      .content {
        padding: 20px 16px 56px;
      }
    }
  `,
})
export class AppShell {}
