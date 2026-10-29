export function createRecentThreadCycle(navigate: (key: string) => void) {
  let recent: string[] = [];
  let cycle: string[] | null = null;
  let selected: string | null = null;
  let requested: string | null = null;

  const promote = (key: string) => {
    recent = [key, ...recent.filter((entry) => entry !== key)];
  };

  const visit = (key: string) => {
    if (key === requested) requested = null;
    if (cycle !== null) return;
    requested = null;
    promote(key);
  };

  return {
    visit,
    next(availableKeys: readonly string[], currentKey: string | null): string | null {
      const available = new Set(availableKeys);
      recent = recent.filter((key) => available.has(key));
      if (requested !== null && !available.has(requested)) requested = null;
      if (cycle === null) {
        const startKey = requested ?? currentKey;
        if (startKey !== null && available.has(startKey)) promote(startKey);
        recent = [...new Set([...recent, ...availableKeys])];
        cycle = recent;
        selected = startKey;
      }
      const index = cycle.indexOf(selected ?? "");
      for (let offset = 1; offset <= cycle.length; offset += 1) {
        const key = cycle[(index + offset) % cycle.length]!;
        if (available.has(key)) {
          selected = key;
          if (key !== (requested ?? currentKey)) {
            requested = key === currentKey ? null : key;
            navigate(key);
          }
          return key;
        }
      }
      return null;
    },
    finish() {
      cycle = null;
      if (selected !== null) promote(selected);
      selected = null;
    },
  };
}
