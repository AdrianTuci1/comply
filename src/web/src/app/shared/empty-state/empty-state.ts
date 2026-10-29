import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { Icon, IconName } from '../icon/icon';

@Component({
  selector: 'app-empty-state',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon],
  template: `
    <div class="empty">
      <span class="empty__icon"><app-icon [name]="icon()" [size]="22" /></span>
      <h3>{{ title() }}</h3>
      <p>{{ message() }}</p>
      <ng-content />
    </div>
  `,
  styles: `
    .empty {
      display: flex;
      flex-direction: column;
      align-items: center;
      text-align: center;
      padding: 56px 24px;
      gap: 6px;
    }
    .empty__icon {
      display: grid;
      place-items: center;
      width: 44px;
      height: 44px;
      border-radius: 12px;
      background: #f1f3f6;
      color: #7a8494;
      margin-bottom: 8px;
    }
    h3 {
      margin: 0;
      font-size: 15px;
      font-weight: 600;
      color: var(--text);
    }
    p {
      margin: 0;
      font-size: 13.5px;
      color: var(--text-muted);
      max-width: 44ch;
    }
  `,
})
export class EmptyState {
  readonly title = input.required<string>();
  readonly message = input('');
  readonly icon = input<IconName>('boards');
}
