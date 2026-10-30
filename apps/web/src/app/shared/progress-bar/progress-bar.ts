import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

@Component({
  selector: 'app-progress-bar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      class="track"
      role="progressbar"
      [attr.aria-valuenow]="clamped()"
      aria-valuemin="0"
      aria-valuemax="100"
    >
      <span class="fill" [class]="'fill--' + tone()" [style.width.%]="clamped()"></span>
    </div>
  `,
  styles: `
    .track {
      height: 6px;
      border-radius: 999px;
      background: #eef0f4;
      overflow: hidden;
    }
    .fill {
      display: block;
      height: 100%;
      border-radius: inherit;
      transition: width 240ms ease;
    }
    .fill--success {
      background: var(--accent);
    }
    .fill--warn {
      background: #d9a441;
    }
    .fill--danger {
      background: var(--danger);
    }
    .fill--info {
      background: var(--info);
    }
    .fill--neutral {
      background: #98a2b3;
    }
  `,
})
export class ProgressBar {
  readonly value = input.required<number>();
  readonly tone = input<'success' | 'warn' | 'danger' | 'info' | 'neutral'>('success');

  readonly clamped = computed(() => Math.max(0, Math.min(100, Math.round(this.value()))));
}
