import { DomainError } from '../../shared-kernel/domain-error';
import { ValueObject } from '../../shared-kernel/value-object';
import { TRUST_CATEGORY_ORDER, TrustCategory } from '../trust/trust-claim';

export interface TrustCenterSettingsProps {
  domain: string;
  published: boolean;
  showEvidence: boolean;
  allowNda: boolean;
  /** Logo uploaded by the tenant, used when no header image is set. */
  logoUrl?: string;
  /** Full-width header image. The public header renders only images. */
  headerUrl?: string;
  /** Display names that replace the default labels of the control categories. */
  categoryLabels?: Partial<Record<TrustCategory, string>>;
  /** Control categories the tenant keeps off the public page. */
  hiddenCategories?: readonly TrustCategory[];
  /** Subprocessors the tenant keeps off the public page. */
  hiddenSubprocessors?: readonly string[];
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
    return new TrustCenterSettings({
      ...props,
      domain: props.domain.trim(),
      categoryLabels: normalizeCategoryLabels(props.categoryLabels),
      hiddenCategories: normalizeHiddenCategories(props.hiddenCategories),
      hiddenSubprocessors: normalizeIds(props.hiddenSubprocessors),
    });
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

  get categoryLabels(): Readonly<Partial<Record<TrustCategory, string>>> {
    return { ...(this.props.categoryLabels ?? {}) };
  }

  get hiddenCategories(): readonly TrustCategory[] {
    return [...(this.props.hiddenCategories ?? [])];
  }

  get hiddenSubprocessors(): readonly string[] {
    return [...(this.props.hiddenSubprocessors ?? [])];
  }

  categoryLabel(category: TrustCategory, fallback: string): string {
    return this.props.categoryLabels?.[category] ?? fallback;
  }

  isCategoryVisible(category: TrustCategory): boolean {
    return !(this.props.hiddenCategories ?? []).includes(category);
  }

  isSubprocessorPublished(id: string): boolean {
    return !(this.props.hiddenSubprocessors ?? []).includes(id);
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

function normalizeCategoryLabels(
  labels: Partial<Record<TrustCategory, string>> | undefined,
): Partial<Record<TrustCategory, string>> {
  const normalized: Partial<Record<TrustCategory, string>> = {};
  if (!labels) return normalized;
  for (const category of TRUST_CATEGORY_ORDER) {
    const label = labels[category]?.trim();
    if (label) normalized[category] = label;
  }
  return normalized;
}

function normalizeHiddenCategories(
  categories: readonly TrustCategory[] | undefined,
): readonly TrustCategory[] {
  if (!categories) return [];
  return [...new Set(categories.filter((category) => TRUST_CATEGORY_ORDER.includes(category)))];
}

function normalizeIds(ids: readonly string[] | undefined): readonly string[] {
  if (!ids) return [];
  return [...new Set(ids.map((id) => id.trim()).filter((id) => id.length > 0))];
}
