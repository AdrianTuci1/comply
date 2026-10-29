/**
 * Explicit success/failure value used at the edges of the domain
 * (import, validation) so that expected failures stay in the type signature.
 */
export class Result<T> {
  private constructor(
    private readonly _value: T | null,
    readonly error: string | null,
  ) {}

  static ok<T>(value: T): Result<T> {
    return new Result<T>(value, null);
  }

  static fail<T>(error: string): Result<T> {
    return new Result<T>(null, error);
  }

  get isSuccess(): boolean {
    return this.error === null;
  }

  get isFailure(): boolean {
    return !this.isSuccess;
  }

  get value(): T {
    if (this._value === null) {
      throw new Error('Cannot read the value of a failed result.');
    }
    return this._value;
  }

  map<U>(mapper: (value: T) => U): Result<U> {
    return this.isSuccess ? Result.ok(mapper(this.value)) : Result.fail<U>(this.error!);
  }
}
