/**
 * The page ground.
 *
 * Was three blurred colour orbs (indigo, fuchsia, cyan) drifting on 22-28
 * second loops behind every screen. They were the most expensive thing on the
 * page — three composited blur layers animating forever — and they reported
 * nothing, which is the definition of decoration.
 *
 * What replaces them is deliberately almost nothing: a single vignette that
 * settles the top of the viewport and lets the hairline grid in index.css
 * carry the sense of structure. The component is kept rather than deleted so
 * the two call sites (App, RequireAuth) stay untouched and the ground remains
 * one thing that one file decides.
 */
export function BackgroundOrbs() {
  return (
    <div
      aria-hidden="true"
      className="fixed inset-0 -z-10 overflow-hidden pointer-events-none"
    >
      {/* A cool wash at the top edge, so the header has something to sit on
          and the page does not read as a flat black rectangle. */}
      <div
        className="absolute inset-x-0 top-0 h-[38rem]"
        style={{
          background:
            "radial-gradient(ellipse 120% 100% at 50% -20%, rgba(255,255,255,0.045), transparent 70%)",
        }}
      />
      {/* One low, wide band of the accent along the bottom, at 3% — enough to
          keep the ground from being neutral grey, far too little to notice as
          colour. */}
      <div
        className="absolute inset-x-0 bottom-0 h-[24rem]"
        style={{
          background:
            "radial-gradient(ellipse 100% 100% at 50% 120%, rgba(224,166,47,0.03), transparent 65%)",
        }}
      />
    </div>
  );
}
