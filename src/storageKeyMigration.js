/*
 * Reading state that was written before the rename.
 *
 * Durable settings were stored under a `gev:` prefix. Renaming the project moved
 * the writers to `mm:`, and a rename of a STORAGE KEY is not like a rename of a
 * variable: the old value is still sitting in the browser of every person who
 * has used this app, and a reader that only knows the new name does not fail —
 * it quietly finds nothing and hands back a default. The layers someone had
 * switched on come back off; the launcher they dismissed returns.
 *
 * So reads fall back. The value is copied forward on first sight, which lets the
 * old key age out on its own rather than being deleted from under a session that
 * might still be running an older tab.
 */

/** @param {string} key @returns {string} The pre-rename spelling of a key. */
export function legacyStorageKey(key) {
  return String(key).startsWith('mm:') ? `gev:${String(key).slice(3)}` : String(key);
}

/**
 * Read a key, falling back to its pre-rename name.
 *
 * @param {{getItem?: Function, setItem?: Function}|null|undefined} store
 * @param {string} key - The current `mm:` key.
 * @returns {string|null} The stored value, or null.
 */
export function readMigratedItem(store, key) {
  if (!store?.getItem) return null;
  try {
    const current = store.getItem(key);
    if (current !== null && current !== undefined) return current;
  } catch { return null; }

  const legacy = legacyStorageKey(key);
  if (legacy === key) return null;
  try {
    const old = store.getItem(legacy);
    if (old === null || old === undefined) return null;
    // Copy forward, best effort: a storage that refuses writes (private mode,
    // quota) must still let the READ succeed.
    try { store.setItem?.(key, old); } catch { /* the read is what matters */ }
    return old;
  } catch {
    return null;
  }
}
