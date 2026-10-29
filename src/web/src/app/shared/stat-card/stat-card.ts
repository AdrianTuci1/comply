import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { Icon, IconName } from '../icon/icon';

@Component({
  selector: 'app-stat-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon],
  template: `
    <article class="stat" [class]="'stat--' + tone()">
      <div class="stat__top">
        <span class="stat__icon"><app-icon [name]="icon()" [size]="18" /></span>
        <span class="stat__label">{{ label() }}</span>
      </div>
      <p class="stat__value">{{ value() }}</p>
      @if (hint()) {
        <p class="stat__hint">{{ hint() }}</p>
      }
    </article>
  `,
  styles: `
    .stat {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 18px 20px 20px;
      box-shadow: var(--shadow-sm);
    }
    .stat__top {
      display: flex;
      align-items: center;
      gap: 10px;
      margin-bottom: 14px;
    }
    .stat__icon {
      display: grid;
      place-items: center;
      width: 32px;
      height: 32px;
      border-radius: 9px;
      background: #f1f3f6;
      color: #5b6472;
    }
    .stat__label {
      font-size: 13px;
      color: var(--text-muted);
      font-weight: 550;
    }
    .stat__value {
      margin: 0;
      font-size: 30px;
      line-height: 1;
      font-weight: 620;
      letter-spacing: -0.03em;
      color: var(--text);
    }
    .stat__hint {
      margin: 8px 0 0;
      font-size: 12.5px;
      color: var(--text-soft);
    }
    .stat--success .stat__icon {
      background: var(--accent-soft);
      color: var(--accent-strong);
    }
    .stat--warn .stat__icon {
      background: var(--warn-soft);
      color: var(--warn);
    }
    .stat--danger .stat__icon {
      background: var(--danger-soft);
      color: var(--danger);
    }
    .stat--info .stat__icon {
      background: var(--info-soft);
      color: var(--info);
    }
  `,
})
export class StatCard {
  readonly label = input.required<string>();
  readonly value = input.required<string | number>();
  readonly hint = input('');
  readonly icon = input<IconName>('shield');
  readonly tone = input<'default' | 'success' | 'warn' | 'danger' | 'info'>('default');
}
