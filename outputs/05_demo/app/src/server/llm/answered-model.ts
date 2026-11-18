// Did the model the gateway names in its reply match the configured model?
//
// A gateway may serve a request from a different model than the configured one, and the reply's
// `model` field is the only place that shows it. Gateways name models in their own way: the
// configured id can carry a vendor prefix that the reply leaves out ("vendor.model-1" comes back
// as "model-1"), and an alias can come back with a release date added ("model-1-2026-01-31",
// "model-1-20260131", "model-1@20260131"). Those count as the same model; any other difference
// does not, including a longer or shorter version name.

const RELEASE_DATE_TAG = /^(?:-\d\d\d\d-\d\d-\d\d|[-@]\d{8})$/;

function bareId(id: string): string {
  const trimmed = id.trim().toLowerCase();
  const dot = trimmed.indexOf('.');
  // A prefix is letters and dashes before the first dot ("vendor-a."); a dot inside a version ("gpt-5.6") is not one.
  return dot > 0 && /^[a-z-]+$/.test(trimmed.slice(0, dot)) ? trimmed.slice(dot + 1) : trimmed;
}

export function isSameModel(configured: string, reported: string): boolean {
  const expected = bareId(configured);
  const actual = bareId(reported);
  return actual === expected || (actual.startsWith(expected) && RELEASE_DATE_TAG.test(actual.slice(expected.length)));
}
