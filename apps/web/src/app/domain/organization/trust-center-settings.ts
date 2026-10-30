import { DomainError } from '../../shared-kernel/domain-error';
import { ValueObject } from '../../shared-kernel/value-object';

export interface TrustCenterSettingsProps {
  domain: string;
  published: boolean;
  showEvidence: boolean;
  allowNda: boolean;
  /** Logo uploaded by the tenant, used when no header image is set. */
  logoUrl?: string;
  /** Full-width header image. The public header renders only images. */
  headerUrl?: string;
}

/** Publication settings of the public trust center owned by an organization. */
export class TrustCenterSettings extends ValueObject<TrustCenterSettingsProps> {
  private constructor(props: TrustCenterSettingsProps) {
    super(props);
  }

  static create(props: TrustCenterSettingsProps): TrustCenterSettings {
    if (!props.domain.trim()) {
      throw new DomainError('The trust center domain is required.');
    }
    return new TrustCenterSettings({ ...props, domain: props.domain.trim() });
  }

  get domain(): string {
    return this.props.domain;
  }

  get published(): boolean {
    return this.props.published;
  }

  get showEvidence(): boolean {
    return this.props.showEvidence;
  }

  get allowNda(): boolean {
    return this.props.allowNda;
  }

  get logoUrl(): string | null {
    return this.props.logoUrl?.trim() || null;
  }

  get headerUrl(): string | null {
    return this.props.headerUrl?.trim() || null;
  }

  /** The page is visible to visitors only when it is explicitly published. */
  get isPublic(): boolean {
    return this.props.published;
  }

  with(patch: Partial<TrustCenterSettingsProps>): TrustCenterSettings {
    return TrustCenterSettings.create({ ...this.props, ...patch });
  }

  toJSON(): TrustCenterSettingsProps {
    return { ...this.props };
  }
}
