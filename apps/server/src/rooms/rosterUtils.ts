import { Member } from '@tether/shared/protocol/schemas';

/**
 * Disambiguates duplicate display names case-insensitively.
 * Earliest joined member keeps original name "Alice".
 * Subsequent members with matching case-insensitive name become "Alice (2)", "Alice (3)", etc.
 */
export function disambiguateDisplayNames(members: Member[]): Member[] {
  const nameCounts = new Map<string, number>();

  for (const m of members) {
    const key = m.name.toLowerCase();
    nameCounts.set(key, (nameCounts.get(key) ?? 0) + 1);
  }

  const currentSuffix = new Map<string, number>();
  return members.map((m) => {
    const key = m.name.toLowerCase();
    const total = nameCounts.get(key) ?? 1;
    if (total <= 1) {
      return { ...m };
    }

    const count = (currentSuffix.get(key) ?? 0) + 1;
    currentSuffix.set(key, count);

    if (count === 1) {
      return { ...m };
    }

    return {
      ...m,
      name: `${m.name} (${count})`,
    };
  });
}
