/** กติกาตั้งชื่อ: คอลัมน์ SQL (PascalCase / snake_case) -> property camelCase ของ TypeScript */
const RGP_PREFIXES = new Set(['i', 'c', 'n', 'd', 'f']);

export function tokens(name: string): string[] {
  return name
    .split(/[_\s]+/)
    .filter(Boolean)
    .flatMap((part) => part.match(/[A-Z]+(?![a-z])|[A-Z]?[a-z0-9]+|[A-Z]/g) ?? [part]);
}

export function toCamel(name: string, stripRgpPrefix = false): string {
  let parts = tokens(name);
  if (stripRgpPrefix && name.includes('_') && parts.length > 1 && RGP_PREFIXES.has(parts[0])) {
    parts = parts.slice(1);
  }
  return parts
    .map((p, i) => {
      const lower = p.toLowerCase();
      return i === 0 ? lower : lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join('');
}

export function toPascal(name: string): string {
  const c = toCamel(name);
  return c.charAt(0).toUpperCase() + c.slice(1);
}

export function toKebab(className: string): string {
  return className
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1-$2')
    .toLowerCase();
}
