import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';

/** Persistent trust-center header. The tenant uploads this image; it carries no text. */
@Component({
  selector: 'app-trust-header',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
  template: `
    <header class="header">
      <div class="header__inner">
        <a class="brand" [routerLink]="['/t', slug()]" [attr.aria-label]="tenantName()">
          @if (logoUrl(); as logo) {
            <img class="brand__logo" [src]="logo" [alt]="tenantName()" />
          } @else {
            <span class="brand__placeholder" aria-hidden="true"></span>
          }
        </a>
      </div>
    </header>
  `,
  styles: `
    :host {
      position: sticky;
      top: 0;
      z-index: 50;
      display: block;
    }

    .header {
      background: rgba(255, 255, 255, 0.96);
      border-bottom: 1px solid #ececf0;
      backdrop-filter: blur(14px);
    }

    .header__inner {
      display: flex;
      align-items: center;
      width: 100%;
      height: 62px;
      padding: 0 28px;
    }

    .brand {
      display: inline-flex;
      align-items: center;
      min-width: 0;
      text-decoration: none;
    }

    .brand__logo {
      display: block;
      width: auto;
      max-width: 240px;
      height: 36px;
      object-fit: contain;
    }

    .brand__placeholder {
      display: block;
      width: 132px;
      height: 30px;
      border-radius: 7px;
      background: #eef0f3;
    }

    @media (max-width: 760px) {
      .header__inner {
        height: 54px;
        padding: 0 16px;
      }

      .brand__logo {
        max-width: 180px;
        height: 30px;
      }
    }
  `,
})
export class TrustHeader {
  readonly slug = input.required<string>();
  readonly tenantName = input.required<string>();
  readonly logoUrl = input<string | null>(null);
}
