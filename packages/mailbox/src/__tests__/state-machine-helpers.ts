/// <reference types="jest" />

/**
 * The JSON body of one state of a rendered state-machine definition, found by brace counting on the
 * state's own `"<name>":{` key. A substring window would as often land on another state's
 * `"Next":"<name>"` as on the definition, and breaks on a Choice's nested `Choices` array.
 */
export function stateBodyOf(definition: string, stateName: string): string {
  const marker      = `"${stateName}":{`;
  const markerIndex = definition.indexOf(marker);
  expect(markerIndex).toBeGreaterThanOrEqual(0);

  const start = markerIndex + marker.length - 1;
  let depth   = 0;
  for (let end = start; end < definition.length; end++) {
    if (definition[end] === '{') {
      depth++;
    } else if (definition[end] === '}') {
      depth--;
      if (depth === 0) {
        return definition.slice(start, end + 1);
      }
    }
  }
  throw new Error(`State '${stateName}' is not closed in the definition`);
}
