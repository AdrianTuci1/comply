import { TrustCategory } from '../../domain/trust/trust-claim';

/** Default names of the five control categories. Tenants can override them in the portal. */
export const DEFAULT_TRUST_CATEGORY_LABELS: Record<TrustCategory, string> = {
  infrastructure: 'Infrastructure security',
  organizational: 'Organizational security',
  product: 'Product security',
  procedures: 'Internal procedures',
  data_privacy: 'Data and privacy',
};
