// Whether the model the gateway reported is the model the route asked for.
//
// A gateway can answer with another model than the one requested (seen in June 2026: a
// request for gpt-4o answered by gpt-5-mini). The reply's `model` field is the only record
// of who answered, so it is compared with the configured id.
//
// MEASURED 2026-11-17: the reply names the vendor's model, without a catalogue prefix
// ("vendor.model-1" answers as "model-1") and, for an undated alias, with the snapshot
// date ("model-1" answers as "model-1-2026-09-29"). Anything else is another model.

const SNAPSHOT_SUFFIX = /^(-\d{4}-\d{2}-\d{2}|-\d{8}|@\d{8})$/;
const withoutCatalogPrefix = (id: string) => id.trim().replace(/^[a-z-]+\./i, '').toLowerCase();

export function isSameModel(requested: string, reported: string): boolean {
  const want = withoutCatalogPrefix(requested);
  const got = withoutCatalogPrefix(reported);
  if (got === want) return true;
  return got.startsWith(want) && SNAPSHOT_SUFFIX.test(got.slice(want.length));
}
