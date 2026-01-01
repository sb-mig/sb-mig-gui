/**
 * Set utility functions for immutable Set operations
 */

/**
 * Toggle an item in a Set (add if not present, remove if present)
 * Returns a new Set instance
 */
export function toggleSetItem<T>(set: Set<T>, item: T): Set<T> {
  const next = new Set(set);
  if (next.has(item)) {
    next.delete(item);
  } else {
    next.add(item);
  }
  return next;
}

/**
 * Add multiple items to a Set
 * Returns a new Set instance
 */
export function addToSet<T>(set: Set<T>, items: T[]): Set<T> {
  const next = new Set(set);
  items.forEach((item) => next.add(item));
  return next;
}

/**
 * Remove multiple items from a Set
 * Returns a new Set instance
 */
export function removeFromSet<T>(set: Set<T>, items: T[]): Set<T> {
  const next = new Set(set);
  items.forEach((item) => next.delete(item));
  return next;
}

/**
 * Check if all items are in the Set
 */
export function hasAllItems<T>(set: Set<T>, items: T[]): boolean {
  return items.every((item) => set.has(item));
}

/**
 * Check if any items are in the Set
 */
export function hasAnyItems<T>(set: Set<T>, items: T[]): boolean {
  return items.some((item) => set.has(item));
}

/**
 * Toggle all items in a Set - if all are selected, remove all; otherwise add all
 */
export function toggleAllItems<T>(set: Set<T>, items: T[]): Set<T> {
  const allSelected = hasAllItems(set, items);
  if (allSelected) {
    return removeFromSet(set, items);
  } else {
    return addToSet(set, items);
  }
}
