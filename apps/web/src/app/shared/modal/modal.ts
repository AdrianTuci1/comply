import { ChangeDetectionStrategy, Component, HostListener, input, output } from '@angular/core';
import { Icon } from '../icon/icon';

@Component({
  selector: 'app-modal',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon],
  template: `
    <div class="backdrop" (click)="close.emit()"></div>
    <div
      class="panel"
      [class.panel--wide]="wide()"
      role="dialog"
      aria-modal="true"
      [attr.aria-label]="title()"
    >
      <header class="panel__head">
        <h2>{{ title() }}</h2>
        <button
          type="button"
          class="btn btn--icon"
          [attr.aria-label]="closeLabel()"
          (click)="close.emit()"
        >
          <app-icon name="x" [size]="18" />
        </button>
      </header>
      <div class="panel__body">
        <ng-content />
      </div>
    </div>
  `,
  styles: `
    :host {
      display: block;
    }

    .backdrop {
      position: fixed;
      inset: 0;
      z-index: 100;
      background: rgba(16, 24, 40, 0.44);
      backdrop-filter: blur(2px);
    }

    .panel {
      position: fixed;
      z-index: 101;
      left: 50%;
      top: 50%;
      transform: translate(-50%, -50%);
      width: min(480px, calc(100vw - 32px));
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 14px;
      box-shadow: 0 24px 64px rgba(16, 24, 40, 0.24);
      overflow: hidden;
    }

    .panel--wide {
      width: min(880px, calc(100vw - 32px));
    }

    .panel--wide .panel__body {
      max-height: min(72vh, 760px);
      overflow: auto;
    }

    .panel__head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 16px 18px;
      border-bottom: 1px solid var(--border);
    }

    .panel__head h2 {
      margin: 0;
      font-size: 15px;
      font-weight: 620;
      letter-spacing: -0.01em;
    }

    .panel__body {
      padding: 18px;
    }
  `,
})
export class Modal {
  readonly title = input.required<string>();
  readonly wide = input(false);
  readonly closeLabel = input('Close');
  readonly close = output<void>();

  @HostListener('document:keydown.escape')
  onEscape(): void {
    this.close.emit();
  }
}
