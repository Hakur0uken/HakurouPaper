export type SequenceChange<T> = { from: number; to: number; insert: T[] };

/** Bounded LCS after trimming equal ends. A large unmatched region stays whole. */
export function sequenceChanges<T>(before: readonly T[], after: readonly T[], equal: (a: T, b: T) => boolean = Object.is): SequenceChange<T>[] {
  let head = 0;
  while (head < before.length && head < after.length && equal(before[head]!, after[head]!)) head++;
  let tail = 0;
  while (tail < before.length - head && tail < after.length - head && equal(before[before.length - 1 - tail]!, after[after.length - 1 - tail]!)) tail++;
  const n = before.length - head - tail, m = after.length - head - tail;
  if (!n && !m) return [];
  if (!n || !m || (n + 1) * (m + 1) > 1_000_000) return [{ from: head, to: head + n, insert: after.slice(head, head + m) }];
  const width = m + 1;
  const table = new Uint32Array((n + 1) * width);
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) {
    table[i * width + j] = equal(before[head + i]!, after[head + j]!)
      ? 1 + table[(i + 1) * width + j + 1]!
      : Math.max(table[(i + 1) * width + j]!, table[i * width + j + 1]!);
  }
  const changes: SequenceChange<T>[] = [];
  let i = 0, j = 0, pending: SequenceChange<T> | undefined;
  const flush = () => { if (pending) changes.push(pending); pending = undefined; };
  while (i < n || j < m) {
    if (i < n && j < m && equal(before[head + i]!, after[head + j]!)) { flush(); i++; j++; continue; }
    pending ??= { from: head + i, to: head + i, insert: [] };
    if (j < m && (i === n || table[i * width + j + 1]! > table[(i + 1) * width + j]!)) pending.insert.push(after[head + j++]!);
    else pending.to = head + ++i;
  }
  flush();
  return changes;
}
