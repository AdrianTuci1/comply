import { FrameworkId, isFrameworkId } from '../compliance/framework';
import { DomainError } from '../../shared-kernel/domain-error';
import { Entity } from '../../shared-kernel/entity';

export const SOURCE_LICENSES = ['public', 'proprietary'] as const;
export const SOURCE_KINDS = ['pdf', 'docx', 'html', 'markdown', 'text'] as const;

export type SourceLicense = (typeof SOURCE_LICENSES)[number];
export type SourceKind = (typeof SOURCE_KINDS)[number];

export interface ContentSourceSnapshot {
  id: string;
  frameworkId: FrameworkId;
  title: string;
  publisher: string;
  version: string;
  kind: SourceKind;
  license: SourceLicense;
  importedAt: string;
  lastReviewedAt: string | null;
}

/** An official document ingested into the requirement library. */
export class ContentSource extends Entity<string> {
  private constructor(
    id: string,
    private readonly _frameworkId: FrameworkId,
    private readonly _title: string,
    private readonly _publisher: string,
    private readonly _version: string,
    private readonly _kind: SourceKind,
    private readonly _license: SourceLicense,
    private readonly _importedAt: string,
    private readonly _lastReviewedAt: string | null,
  ) {
    super(id);
  }

  static create(props: {
    id: string;
    frameworkId: FrameworkId;
    title: string;
    publisher: string;
    version: string;
    kind: SourceKind;
    license: SourceLicense;
    importedAt: string;
  }): ContentSource {
    return new ContentSource(
      props.id,
      requireFramework(props.frameworkId),
      requireText(props.title, 'The source title is required.'),
      requireText(props.publisher, 'The source publisher is required.'),
      requireText(props.version, 'The source version is required.'),
      requireKind(props.kind),
      requireLicense(props.license),
      props.importedAt,
      null,
    );
  }

  static restore(snapshot: ContentSourceSnapshot): ContentSource {
    return new ContentSource(
      snapshot.id,
      requireFramework(snapshot.frameworkId),
      requireText(snapshot.title, 'The source title is required.'),
      requireText(snapshot.publisher, 'The source publisher is required.'),
      requireText(snapshot.version, 'The source version is required.'),
      requireKind(snapshot.kind),
      requireLicense(snapshot.license),
      snapshot.importedAt,
      snapshot.lastReviewedAt,
    );
  }

  get frameworkId(): FrameworkId {
    return this._frameworkId;
  }

  get title(): string {
    return this._title;
  }

  get publisher(): string {
    return this._publisher;
  }

  get version(): string {
    return this._version;
  }

  get kind(): SourceKind {
    return this._kind;
  }

  get license(): SourceLicense {
    return this._license;
  }

  get importedAt(): string {
    return this._importedAt;
  }

  get lastReviewedAt(): string | null {
    return this._lastReviewedAt;
  }

  get isProprietary(): boolean {
    return this._license === 'proprietary';
  }

  markReviewed(reviewedAt: string): ContentSource {
    return new ContentSource(
      this.id,
      this._frameworkId,
      this._title,
      this._publisher,
      this._version,
      this._kind,
      this._license,
      this._importedAt,
      reviewedAt,
    );
  }

  toSnapshot(): ContentSourceSnapshot {
    return {
      id: this.id,
      frameworkId: this._frameworkId,
      title: this._title,
      publisher: this._publisher,
      version: this._version,
      kind: this._kind,
      license: this._license,
      importedAt: this._importedAt,
      lastReviewedAt: this._lastReviewedAt,
    };
  }
}

function requireFramework(value: FrameworkId): FrameworkId {
  if (!isFrameworkId(value)) {
    throw new DomainError('Unknown framework for the source.');
  }
  return value;
}

function requireText(value: string, message: string): string {
  const text = value.trim();
  if (!text) {
    throw new DomainError(message);
  }
  return text;
}

function requireKind(value: SourceKind): SourceKind {
  if (!SOURCE_KINDS.includes(value)) {
    throw new DomainError('Unknown document type.');
  }
  return value;
}

function requireLicense(value: SourceLicense): SourceLicense {
  if (!SOURCE_LICENSES.includes(value)) {
    throw new DomainError('Unknown source license.');
  }
  return value;
}
