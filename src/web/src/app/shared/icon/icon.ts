import { ChangeDetectionStrategy, Component, input } from '@angular/core';

export type IconName =
  | 'dashboard'
  | 'users'
  | 'globe'
  | 'settings'
  | 'boards'
  | 'bot'
  | 'search'
  | 'plus'
  | 'chevron-down'
  | 'chevron-right'
  | 'logout'
  | 'book'
  | 'download'
  | 'upload'
  | 'check'
  | 'x'
  | 'clock'
  | 'shield'
  | 'arrow-right'
  | 'external'
  | 'alert'
  | 'filter'
  | 'building'
  | 'key'
  | 'file'
  | 'more'
  | 'mail'
  | 'copy'
  | 'eye'
  | 'bell'
  | 'lock'
  | 'chevron-left'
  | 'arrow-up'
  | 'menu';

@Component({
  selector: 'app-icon',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <svg
      [attr.width]="size()"
      [attr.height]="size()"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      [attr.stroke-width]="strokeWidth()"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      @switch (name()) {
        @case ('dashboard') {
          <rect x="3" y="3" width="7.5" height="7.5" rx="1.6" />
          <rect x="13.5" y="3" width="7.5" height="7.5" rx="1.6" />
          <rect x="3" y="13.5" width="7.5" height="7.5" rx="1.6" />
          <rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.6" />
        }
        @case ('users') {
          <circle cx="9" cy="8" r="3.2" />
          <path d="M2.8 19.5c0-3.2 2.8-5.8 6.2-5.8s6.2 2.6 6.2 5.8" />
          <path d="M16 4.8a3.2 3.2 0 0 1 0 6.4" />
          <path d="M17.8 14.2c2 .7 3.4 2.5 3.4 5.3" />
        }
        @case ('globe') {
          <circle cx="12" cy="12" r="9" />
          <path d="M3 12h18" />
          <path
            d="M12 3c2.5 2.4 3.8 5.5 3.8 9S14.5 18.6 12 21c-2.5-2.4-3.8-5.5-3.8-9S9.5 5.4 12 3z"
          />
        }
        @case ('settings') {
          <path d="M4 7h9" />
          <path d="M17 7h3" />
          <circle cx="15" cy="7" r="2" />
          <path d="M4 17h3" />
          <path d="M11 17h9" />
          <circle cx="9" cy="17" r="2" />
        }
        @case ('menu') {
          <path d="M4 7h16" />
          <path d="M4 12h16" />
          <path d="M4 17h16" />
        }
        @case ('bot') {
          <rect x="4" y="7" width="16" height="12" rx="3" />
          <path d="M12 3v4" />
          <path d="M8.5 12v2" />
          <path d="M15.5 12v2" />
          <path d="M9 16.5h6" />
        }
        @case ('boards') {
          <rect x="5" y="4" width="14" height="17" rx="2.5" />
          <path d="M9 4V3.2A1.2 1.2 0 0 1 10.2 2h3.6A1.2 1.2 0 0 1 15 3.2V4" />
          <path d="M9 11.5l2 2 4-4" />
        }
        @case ('search') {
          <circle cx="11" cy="11" r="7" />
          <path d="M20 20l-3.6-3.6" />
        }
        @case ('plus') {
          <path d="M12 5v14" />
          <path d="M5 12h14" />
        }
        @case ('chevron-down') {
          <path d="M6 9l6 6 6-6" />
        }
        @case ('chevron-right') {
          <path d="M9 6l6 6-6 6" />
        }
        @case ('logout') {
          <path d="M9 21H5.5A2.5 2.5 0 0 1 3 18.5v-13A2.5 2.5 0 0 1 5.5 3H9" />
          <path d="M16 16.5L20.5 12 16 7.5" />
          <path d="M20.5 12H9" />
        }
        @case ('book') {
          <path
            d="M12 6.5C10 5 7.5 4.2 4 4.2v14.6c3.5 0 6 .8 8 2.2 2-1.4 4.5-2.2 8-2.2V4.2c-3.5 0-6 .8-8 2.3z"
          />
          <path d="M12 6.5v14.5" />
        }
        @case ('download') {
          <path d="M12 3v12" />
          <path d="M7.5 10.5L12 15l4.5-4.5" />
          <path d="M4 20h16" />
        }
        @case ('upload') {
          <path d="M12 20V8" />
          <path d="M7.5 12.5L12 8l4.5 4.5" />
          <path d="M4 4h16" />
        }
        @case ('check') {
          <path d="M4.5 12.5l4.5 4.5L19.5 6.5" />
        }
        @case ('x') {
          <path d="M6 6l12 12" />
          <path d="M18 6L6 18" />
        }
        @case ('clock') {
          <circle cx="12" cy="12" r="9" />
          <path d="M12 7v5.2l3.2 2" />
        }
        @case ('shield') {
          <path d="M12 3l8 3v6c0 4.8-3.4 8-8 9-4.6-1-8-4.2-8-9V6z" />
          <path d="M9 12l2 2 4-4.2" />
        }
        @case ('arrow-right') {
          <path d="M4.5 12h15" />
          <path d="M13 5.5l6.5 6.5-6.5 6.5" />
        }
        @case ('external') {
          <path d="M14 4h6v6" />
          <path d="M20 4l-8.5 8.5" />
          <path
            d="M19 14v4.5A2.5 2.5 0 0 1 16.5 21h-11A2.5 2.5 0 0 1 3 18.5v-11A2.5 2.5 0 0 1 5.5 5H10"
          />
        }
        @case ('alert') {
          <path d="M12 3.5L21 20H3z" />
          <path d="M12 9.5v4.5" />
          <circle cx="12" cy="17" r="0.7" fill="currentColor" stroke="none" />
        }
        @case ('filter') {
          <path d="M4 5h16l-6.2 7.2V19L10.2 21v-8.8z" />
        }
        @case ('building') {
          <rect x="4" y="3" width="16" height="18" rx="2" />
          <path d="M9 7h1.5M13.5 7H15M9 11h1.5M13.5 11H15M9 15h1.5M13.5 15H15" />
          <path d="M10 21v-3h4v3" />
        }
        @case ('key') {
          <circle cx="8" cy="8" r="4" />
          <path d="M11 11l9 9" />
          <path d="M17 17l2-2" />
          <path d="M14.5 14.5l2-2" />
        }
        @case ('file') {
          <path d="M6 3h8l5 5v13H6z" />
          <path d="M14 3v5h5" />
          <path d="M9 13h6M9 17h6" />
        }
        @case ('more') {
          <circle cx="5" cy="12" r="1.4" fill="currentColor" stroke="none" />
          <circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" />
          <circle cx="19" cy="12" r="1.4" fill="currentColor" stroke="none" />
        }
        @case ('mail') {
          <rect x="3" y="5" width="18" height="14" rx="2" />
          <path d="M3.5 6.5l8.5 6 8.5-6" />
        }
        @case ('copy') {
          <rect x="9" y="9" width="11" height="11" rx="2" />
          <path d="M6 15H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v1" />
        }
        @case ('eye') {
          <path d="M2.5 12s3.5-6.5 9.5-6.5S21.5 12 21.5 12s-3.5 6.5-9.5 6.5S2.5 12 2.5 12z" />
          <circle cx="12" cy="12" r="2.8" />
        }
        @case ('bell') {
          <path d="M18 9.5a6 6 0 1 0-12 0c0 4-1.5 5.5-1.5 5.5h15S18 13.5 18 9.5z" />
          <path d="M10 18.5a2.2 2.2 0 0 0 4 0" />
        }
        @case ('lock') {
          <rect x="4.5" y="10" width="15" height="11" rx="2.2" />
          <path d="M8 10V7.5a4 4 0 0 1 8 0V10" />
        }
        @case ('chevron-left') {
          <path d="M15 6l-6 6 6 6" />
        }
        @case ('arrow-up') {
          <path d="M12 20V4" />
          <path d="M5.5 10.5L12 4l6.5 6.5" />
        }
      }
    </svg>
  `,
  styles: `
    :host {
      display: inline-flex;
      flex: none;
    }
  `,
})
export class Icon {
  readonly name = input.required<IconName>();
  readonly size = input(18);
  readonly strokeWidth = input(1.75);
}
