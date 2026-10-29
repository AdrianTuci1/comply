/**
 * Shared kernel: tiny building blocks reused by every bounded context.
 * These types have no dependency on Angular or on any other layer.
 */

export abstract class Entity<TId extends string> {
  protected constructor(readonly id: TId) {}

  equals(other?: Entity<TId>): boolean {
    return !!other && this.id === other.id;
  }
}
