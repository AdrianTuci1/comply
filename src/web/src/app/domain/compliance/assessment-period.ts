import { DomainError } from '../../shared-kernel/domain-error';
import { ValueObject } from '../../shared-kernel/value-object';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Inclusive assessment window, expressed as ISO calendar dates. */
export class AssessmentPeriod extends ValueObject<{ from: string; to: string }> {
  private constructor(props: { from: string; to: string }) {
    super(props);
  }

  static create(from: string, to: string): AssessmentPeriod {
    if (!ISO_DATE.test(from) || !ISO_DATE.test(to)) {
      throw new DomainError('The period must use ISO dates (YYYY-MM-DD).');
    }
    if (from > to) {
      throw new DomainError('The start date cannot be after the end date.');
    }
    return new AssessmentPeriod({ from, to });
  }

  static forYear(year: number): AssessmentPeriod {
    return AssessmentPeriod.create(`${year}-01-01`, `${year}-12-31`);
  }

  get from(): string {
    return this.props.from;
  }

  get to(): string {
    return this.props.to;
  }

  get fromYear(): string {
    return this.props.from.slice(0, 4);
  }

  get toYear(): string {
    return this.props.to.slice(0, 4);
  }
}
