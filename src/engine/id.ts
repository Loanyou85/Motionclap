let counter = 0;

/** Identifiant court et unique (suffisant pour un projet local). */
export function uid(prefix = ''): string {
  counter = (counter + 1) % 1679616;
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}${Date.now().toString(36)}${counter.toString(36)}${rand}`;
}
