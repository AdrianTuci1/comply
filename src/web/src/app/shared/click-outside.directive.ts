import { Directive, ElementRef, inject, OnDestroy, output } from '@angular/core';

@Directive({
  selector: '[appClickOutside]',
})
export class ClickOutsideDirective implements OnDestroy {
  private readonly host = inject(ElementRef<HTMLElement>);

  readonly appClickOutside = output<void>();

  private readonly onDocumentClick = (event: MouseEvent) => {
    const target = event.target as Node | null;
    if (target && !this.host.nativeElement.contains(target)) {
      this.appClickOutside.emit();
    }
  };

  constructor() {
    document.addEventListener('click', this.onDocumentClick);
  }

  ngOnDestroy(): void {
    document.removeEventListener('click', this.onDocumentClick);
  }
}
