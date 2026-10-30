import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';
import { Icon } from '../../shared/icon/icon';
import { Modal } from '../../shared/modal/modal';

export type AccessDialogMode = 'access' | 'subscribe';

@Component({
  selector: 'app-trust-access-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon, Modal],
  templateUrl: './trust-access-dialog.html',
  styleUrl: './trust-access-dialog.scss',
})
export class TrustAccessDialog {
  readonly mode = input.required<AccessDialogMode>();
  readonly organizationName = input.required<string>();
  readonly contactEmail = input.required<string>();
  readonly subject = input<string | null>(null);

  readonly close = output<void>();

  readonly name = signal('');
  readonly email = signal('');
  readonly company = signal('');
  readonly message = signal('');
  readonly error = signal('');
  readonly mailtoHref = signal('');

  readonly title = computed(() =>
    this.mode() === 'subscribe'
      ? 'Subscribe to updates'
      : this.subject()
        ? `Request access — ${this.subject()}`
        : 'Request audit report',
  );

  readonly isAccess = computed(() => this.mode() === 'access');

  readonly intro = computed(() =>
    this.mode() === 'subscribe'
      ? `Get an email when ${this.organizationName()} publishes a security, privacy or subprocessor update.`
      : `Share your contact details. The request goes to the ${this.organizationName()} team, which will reply and, when needed, send the confidentiality agreement.`,
  );

  update(field: 'name' | 'email' | 'company' | 'message', value: string): void {
    if (field === 'name') this.name.set(value);
    if (field === 'email') this.email.set(value);
    if (field === 'company') this.company.set(value);
    if (field === 'message') this.message.set(value);
    if (this.error()) this.error.set('');
  }

  submit(): void {
    const email = this.email().trim();
    if (!email.includes('@') || !email.includes('.')) {
      this.error.set('Enter a valid email address.');
      return;
    }
    if (this.isAccess() && !this.name().trim()) {
      this.error.set('Your name is required for an access request.');
      return;
    }

    this.error.set('');
    this.mailtoHref.set(this.buildMailto(email));
  }

  private buildMailto(email: string): string {
    const organization = this.organizationName();
    const subject =
      this.mode() === 'subscribe'
        ? `Update subscription — ${organization}`
        : `Access request — ${this.subject() ?? 'Audit report'} — ${organization}`;

    const company = this.company().trim();
    const body =
      this.mode() === 'subscribe'
        ? [`Email: ${email}`, '', `I would like to receive updates published by ${organization}.`]
        : [
            `Name: ${this.name().trim()}`,
            `Email: ${email}`,
            ...(company ? [`Company: ${company}`] : []),
            '',
            this.message().trim() || 'I would like access to the documents available on request.',
          ];

    return `mailto:${this.contactEmail()}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body.join('\n'))}`;
  }
}
