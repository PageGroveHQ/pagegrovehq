const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
export function mergeDocuments(base, local, remote) {
  if (!base)
    return same(local, remote)
      ? { value: local, conflicts: [] }
      : { value: local, conflicts: ["Existing cloud copy"] };
  const result = { ...remote },
    conflicts = [];
  const keys = new Set([
    ...Object.keys(local || {}),
    ...Object.keys(remote || {}),
  ]);
  for (const key of keys) {
    if (
      ["bookmarks", "highlights", "sessions", "annotationTombstones"].includes(
        key,
      )
    ) {
      const entries = new Map((remote[key] || []).map((x) => [x.id, x]));
      for (const item of local[key] || []) {
        const other = entries.get(item.id),
          original = (base[key] || []).find((x) => x.id === item.id);
        if (
          other &&
          !same(item, other) &&
          original &&
          !same(item, original) &&
          !same(other, original) &&
          key !== "sessions" &&
          key !== "annotationTombstones"
        ) {
          conflicts.push(`${key}:${item.id}`);
          entries.set(item.id, item);
        } else if (!other || !same(item, original)) entries.set(item.id, item);
      }
      result[key] = [...entries.values()];
      continue;
    }
    if (same(local[key], base[key])) result[key] = remote[key];
    else if (same(remote[key], base[key]) || same(local[key], remote[key]))
      result[key] = local[key];
    else {
      result[key] = local[key];
      if (!["lastRead", "updatedAt", "secondsRead", "wordsRead"].includes(key))
        conflicts.push(key);
    }
  }
  const dead = new Set((result.annotationTombstones || []).map((t) => t.id));
  for (const key of ["bookmarks", "highlights"])
    if (result[key]) result[key] = result[key].filter((x) => !dead.has(x.id));
  if (result.sessions) {
    const legacySeconds = Math.max(
      0,
      (local.secondsRead || 0) -
        (local.sessions || []).reduce((s, x) => s + x.seconds, 0),
      (remote.secondsRead || 0) -
        (remote.sessions || []).reduce((s, x) => s + x.seconds, 0),
    );
    result.secondsRead =
      legacySeconds + result.sessions.reduce((s, x) => s + x.seconds, 0);
    result.wordsRead = Math.max(local.wordsRead || 0, remote.wordsRead || 0);
  }
  return { value: result, conflicts };
}
