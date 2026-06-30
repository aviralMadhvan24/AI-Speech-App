/**
 * Decorative animated background. Three blurred orbs drift slowly behind
 * the UI. Fixed and non-interactive — never accepts pointer events.
 */
export function BackgroundOrbs() {
  return (
    <div
      aria-hidden="true"
      className="fixed inset-0 -z-10 overflow-hidden pointer-events-none"
    >
      <div
        className="absolute -top-32 -left-32 w-[36rem] h-[36rem] rounded-full blur-3xl bg-brand-600/20 animate-orb-1"
      />
      <div
        className="absolute top-1/3 -right-40 w-[40rem] h-[40rem] rounded-full blur-3xl bg-fuchsia-600/15 animate-orb-2"
      />
      <div
        className="absolute bottom-[-12rem] left-1/4 w-[34rem] h-[34rem] rounded-full blur-3xl bg-cyan-500/10 animate-orb-3"
      />
      <div className="absolute inset-0 bg-gradient-to-b from-transparent via-zinc-950/30 to-zinc-950" />
    </div>
  );
}
