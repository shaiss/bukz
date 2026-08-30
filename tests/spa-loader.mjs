// Test-only resolve hook: web/views.mjs imports analysis modules with
// browser-style absolute paths ('/src/analysis/…') because that's what the
// serve SPA uses. Map them onto the repo root (one level up from tests/),
// independent of the process cwd.
export async function resolve(specifier, context, next) {
  if (specifier.startsWith('/')) {
    return next(new URL('..' + specifier, import.meta.url).href, context);
  }
  return next(specifier, context);
}
