import { DomainError } from '../../shared-kernel/domain-error';
import { ValueObject } from '../../shared-kernel/value-object';
import { ItemStatus } from './item-status';

export interface BoardProgressProps {
  total: number;
  accepted: number;
  proposed: number;
  gaps: number;
}

/**
 * Progress counters of an assessment. Counters include requirements that are
 * not listed in the UI yet, so they are stored on the aggregate rather than
 * derived from the loaded checklist.
 */
export class BoardProgress extends ValueObject<BoardProgressProps> {
  private constructor(props: BoardProgressProps) {
    super(props);
  }

  static create(props: BoardProgressProps): BoardProgress {
    const values = [props.total, props.accepted, props.proposed, props.gaps];
    if (values.some((value) => !Number.isInteger(value) || value < 0)) {
      throw new DomainError('Board counters must be non-negative integers.');
    }
    if (props.accepted > props.total) {
      throw new DomainError('The number of accepted requirements cannot exceed the total.');
    }
    return new BoardProgress(props);
  }

  get total(): number {
    return this.props.total;
  }

  get accepted(): number {
    return this.props.accepted;
  }

  get proposed(): number {
    return this.props.proposed;
  }

  get gaps(): number {
    return this.props.gaps;
  }

  get coverage(): number {
    return this.props.total === 0 ? 0 : Math.round((this.props.accepted / this.props.total) * 100);
  }

  /** Projects a single checklist status change onto the aggregate counters. */
  applyStatusChange(from: ItemStatus, to: ItemStatus): BoardProgress {
    const acceptedDelta = Number(to === 'accepted') - Number(from === 'accepted');
    const proposedDelta = Number(to === 'proposed') - Number(from === 'proposed');

    let gapsDelta = 0;
    if (acceptedDelta > 0 && from !== 'not_applicable') gapsDelta -= 1;
    if (acceptedDelta < 0 && to !== 'not_applicable') gapsDelta += 1;

    return BoardProgress.create({
      total: this.props.total,
      accepted: this.clamp(this.props.accepted + acceptedDelta, this.props.total),
      proposed: this.clamp(this.props.proposed + proposedDelta, this.props.total),
      gaps: this.clamp(this.props.gaps + gapsDelta, this.props.total),
    });
  }

  toJSON(): BoardProgressProps {
    return { ...this.props };
  }

  private clamp(value: number, max: number): number {
    return Math.max(0, Math.min(max, value));
  }
}
