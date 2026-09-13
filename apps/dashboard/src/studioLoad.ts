// Studio's three bootstrap reads — avatars, voices, video history — are independent
// capabilities. The production incident this fixes: Studio previously loaded them with
// `Promise.all`, so one provider failure (an unscoped HeyGen avatar catalog exceeding the
// pagination safety bound) aborted the whole load and hid whether voices or video history even
// worked — the founder's live validation could not tell avatars and voices apart because of it.
//
// `loadStudioData` is `Promise.allSettled` under one typed, independently-resolved-per-surface
// shape, kept as a plain function (no React, no DOM) so this property is unit-testable under the
// repo's Node-only vitest harness (docs/atelier/testing-conventions.md) without a jsdom project.

export type StudioLoadOutcome<T> = { data: T; error?: undefined } | { data?: undefined; error: string };

export interface StudioLoadInputs<A, V, D> {
  avatars: () => Promise<A>;
  voices: () => Promise<V>;
  videos: () => Promise<D>;
}

export interface StudioLoadResult<A, V, D> {
  avatars: StudioLoadOutcome<A>;
  voices: StudioLoadOutcome<V>;
  videos: StudioLoadOutcome<D>;
}

function toOutcome<T>(result: PromiseSettledResult<T>): StudioLoadOutcome<T> {
  return result.status === 'fulfilled' ? { data: result.value } : { error: String(result.reason) };
}

export async function loadStudioData<A, V, D>(
  fns: StudioLoadInputs<A, V, D>
): Promise<StudioLoadResult<A, V, D>> {
  const [avatars, voices, videos] = await Promise.allSettled([fns.avatars(), fns.voices(), fns.videos()]);
  return { avatars: toOutcome(avatars), voices: toOutcome(voices), videos: toOutcome(videos) };
}
