import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

@Component({
  selector: 'app-avatar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <span
      class="avatar"
      [style.width.px]="size()"
      [style.height.px]="size()"
      [style.font-size.px]="size() * 0.36"
      [style.background]="color() || null"
    >
      {{ initials() }}
    </span>
  `,
  styles: `
    .avatar {
      display: inline-grid;
      place-items: center;
      border-radius: 50%;
      background: linear-gradient(135deg, #2f3b4a, #151b23);
      color: #fff;
      font-weight: 600;
      letter-spacing: 0.02em;
      flex: none;
      user-select: none;
    }
  `,
})
export class Avatar {
  readonly name = input.required<string>();
  readonly size = input(34);
  readonly color = input<string | undefined>(undefined);

  readonly initials = computed(() =>
    this.name()
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? '')
      .join(''),
  );
}
