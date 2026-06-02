export function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9/_-]+/g, " ")
    .split(/\s+/)
    .map((part) => part.trim())
    .filter((part) => part.length >= 2);
}

export function textScore(query: string, candidate: string): number {
  const queryTokens = new Set(tokenize(query));
  if (queryTokens.size === 0) return 0;

  const candidateTokens = new Set(tokenize(candidate));
  let hits = 0;
  for (const token of queryTokens) {
    if (candidateTokens.has(token)) hits += 1;
  }

  return hits / queryTokens.size;
}

export function buildTaskSearchText(input: {
  title?: string | null;
  description?: string | null;
  labels?: string[] | null;
  missingContext?: string[] | null;
}): string {
  return [
    input.title,
    input.description,
    ...(input.labels ?? []),
    ...(input.missingContext ?? []),
  ]
    .filter(Boolean)
    .join(" ");
}

export function isMeaningfullyAhead(best: number, second: number): boolean {
  return best >= 0.45 && best - second >= 0.12;
}
