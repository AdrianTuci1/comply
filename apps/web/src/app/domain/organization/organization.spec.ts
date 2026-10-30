import { DomainError } from '../../shared-kernel/domain-error';
import { Organization, OrganizationSnapshot } from './organization';

function snapshot(overrides: Partial<OrganizationSnapshot> = {}): OrganizationSnapshot {
  return {
    id: 'org-1',
    name: 'Nordwind Logistics',
    cui: 'RO12345678',
    slug: 'nordwind',
    plan: 'team',
    initials: 'NW',
    accent: '#0f9d76',
    contactName: 'Ana Popescu',
    contactEmail: 'ana@nordwind.ro',
    trustCenter: {
      domain: 'trust.nordwind.ro',
      published: true,
      showEvidence: true,
      allowNda: true,
    },
    retentionDays: 3650,
    sealedMode: false,
    ...overrides,
  };
}

describe('Organization (aggregate)', () => {
  it('updates the profile without losing the trust center settings', () => {
    const organization = Organization.restore(snapshot());
    const updated = organization.withProfile({ name: 'Nordwind SRL', sealedMode: true });

    expect(updated.name).toBe('Nordwind SRL');
    expect(updated.sealedMode).toBe(true);
    expect(updated.trustCenter.domain).toBe('trust.nordwind.ro');
    expect(updated.contact.name).toBe('Ana Popescu');
  });

  it('unpublishes the trust center through a value object', () => {
    const organization = Organization.restore(snapshot());
    const updated = organization.withTrustCenter({ published: false });

    expect(updated.trustCenter.isPublic).toBe(false);
    expect(organization.trustCenter.isPublic).toBe(true);
  });

  it('keeps the header image separate from the logo', () => {
    const organization = Organization.restore(
      snapshot({
        trustCenter: {
          domain: 'trust.nordwind.ro',
          published: true,
          showEvidence: true,
          allowNda: true,
          logoUrl: '/logos/nordwind.svg',
          headerUrl: '/headers/nordwind.svg',
        },
      }),
    );

    expect(organization.trustCenter.headerUrl).toBe('/headers/nordwind.svg');
    expect(organization.trustCenter.logoUrl).toBe('/logos/nordwind.svg');

    const updated = organization.withTrustCenter({ headerUrl: undefined });

    expect(updated.trustCenter.headerUrl).toBeNull();
    expect(updated.trustCenter.logoUrl).toBe('/logos/nordwind.svg');
  });

  it('normalizes the category and subprocessor presentation settings', () => {
    const organization = Organization.restore(
      snapshot({
        trustCenter: {
          domain: 'trust.nordwind.ro',
          published: true,
          showEvidence: true,
          allowNda: true,
          categoryLabels: { infrastructure: '  Infra  ', organizational: '   ' },
          hiddenCategories: ['organizational', 'organizational'],
          hiddenSubprocessors: [' s-1 ', 's-1', ''],
        },
      }),
    );
    const settings = organization.trustCenter;

    expect(settings.categoryLabel('infrastructure', 'Infrastructure security')).toBe('Infra');
    expect(settings.categoryLabel('organizational', 'Organizational security')).toBe(
      'Organizational security',
    );
    expect(settings.isCategoryVisible('organizational')).toBe(false);
    expect(settings.isCategoryVisible('infrastructure')).toBe(true);
    expect(settings.hiddenSubprocessors).toEqual(['s-1']);
    expect(settings.isSubprocessorPublished('s-1')).toBe(false);
    expect(settings.isSubprocessorPublished('s-2')).toBe(true);

    const updated = organization.withTrustCenter({ published: false });
    expect(updated.trustCenter.hiddenCategories).toEqual(['organizational']);
    expect(updated.trustCenter.categoryLabels).toEqual({ infrastructure: 'Infra' });
  });

  it('rejects an invalid contact email', () => {
    expect(() => Organization.restore(snapshot({ contactEmail: 'not-an-email' }))).toThrow(
      DomainError,
    );
  });

  it('rejects retention windows shorter than 30 days', () => {
    expect(() => Organization.restore(snapshot({ retentionDays: 7 }))).toThrow('at least 30 days');
  });

  it('rejects an empty trust center domain', () => {
    const organization = Organization.restore(snapshot());

    expect(() => organization.withTrustCenter({ domain: '  ' })).toThrow(DomainError);
  });
});
