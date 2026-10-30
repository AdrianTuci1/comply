/**
 * Immutable value object. Two instances are equal when their props are equal.
 * Subclasses validate their own invariants before calling the constructor.
 */
export abstract class ValueObject<TProps extends object> {
  protected constructor(protected readonly props: Readonly<TProps>) {
    Object.freeze(this.props);
  }

  equals(other?: ValueObject<TProps>): boolean {
    if (!other) return false;
    const keys = Object.keys(this.props) as (keyof TProps)[];
    return keys.every((key) => this.props[key] === other.props[key]);
  }
}
