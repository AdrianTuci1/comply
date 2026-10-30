import { ValueObject } from '../../shared-kernel/value-object';

export const FRAMEWORK_IDS = ['nis2', 'iso27001', 'ai-act', 'soc2'] as const;

export type FrameworkId = (typeof FRAMEWORK_IDS)[number];

export interface FrameworkDefinition {
  readonly id: FrameworkId;
  readonly label: string;
  readonly version: string;
  readonly requirementCount: number;
}

/**
 * Strategy table: every framework supplies its own version and default
 * requirement count, so new frameworks are added without touching the UI.
 */
export const FRAMEWORK_CATALOG: Record<FrameworkId, FrameworkDefinition> = {
  nis2: { id: 'nis2', label: 'NIS2', version: 'OUG 155/2024', requirementCount: 84 },
  iso27001: { id: 'iso27001', label: 'ISO 27001', version: '2022', requirementCount: 93 },
  'ai-act': { id: 'ai-act', label: 'EU AI Act', version: '2024/1689', requirementCount: 64 },
  soc2: { id: 'soc2', label: 'SOC 2', version: 'TSC 2017', requirementCount: 61 },
};

export const FRAMEWORKS: readonly FrameworkDefinition[] = FRAMEWORK_IDS.map(
  (id) => FRAMEWORK_CATALOG[id],
);

export function isFrameworkId(value: unknown): value is FrameworkId {
  return typeof value === 'string' && (FRAMEWORK_IDS as readonly string[]).includes(value);
}

/** Framework plus the content version pinned when the assessment was created. */
export class FrameworkRef extends ValueObject<{ framework: FrameworkId; version: string }> {
  private constructor(props: { framework: FrameworkId; version: string }) {
    super(props);
  }

  static of(framework: FrameworkId): FrameworkRef {
    return new FrameworkRef({ framework, version: FRAMEWORK_CATALOG[framework].version });
  }

  static restore(framework: FrameworkId, version: string): FrameworkRef {
    return new FrameworkRef({ framework, version });
  }

  get id(): FrameworkId {
    return this.props.framework;
  }

  get version(): string {
    return this.props.version;
  }

  get label(): string {
    return FRAMEWORK_CATALOG[this.props.framework].label;
  }

  get requirementCount(): number {
    return FRAMEWORK_CATALOG[this.props.framework].requirementCount;
  }
}
