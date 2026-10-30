import { ChangeDetectionStrategy, Component, input } from '@angular/core';

@Component({
  selector: 'app-page-header',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <header class="head">
      <div class="head__text">
        @if (eyebrow()) {
          <p class="head__eyebrow">{{ eyebrow() }}</p>
        }
        <h1 class="head__title">{{ title() }}</h1>
        @if (subtitle()) {
          <p class="head__sub">{{ subtitle() }}</p>
        }
      </div>
      <div class="head__actions">
        <ng-content />
      </div>
    </header>
  `,
  styles: `
    .head {
      display: flex;
      align-items: flex-end;
      justify-content: space-between;
      gap: 24px;
      margin-bottom: 24px;
      flex-wrap: wrap;
    }
    .head__eyebrow {
      margin: 0 0 6px;
      font-size: 12px;
      font-weight: 600;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: var(--text-soft);
    }
    .head__title {
      margin: 0;
      font-size: 26px;
      line-height: 1.15;
      letter-spacing: -0.025em;
      font-weight: 640;
      color: var(--text);
    }
    .head__sub {
      margin: 7px 0 0;
      font-size: 14px;
      color: var(--text-muted);
      max-width: 68ch;
    }
    .head__actions {
      display: flex;
      align-items: center;
      gap: 10px;
      flex-wrap: wrap;
    }
    @media (max-width: 560px) {
      .head__title {
        font-size: 22px;
        overflow-wrap: anywhere;
      }
    }
  `,
})
export class PageHeader {
  readonly title = input.required<string>();
  readonly subtitle = input('');
  readonly eyebrow = input('');
}
