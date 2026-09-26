/** Substitutes `{name}` placeholders in a dictionary string. An unknown
 *  placeholder is left as written rather than rendered as "undefined".
 *  Client-safe. */
export const fill = (template: string, vars: Record<string, string | number>) =>
  template.replace(/\{(\w+)\}/g, (match, key: string) =>
    Object.prototype.hasOwnProperty.call(vars, key) ? String(vars[key]) : match,
  );
