export function DemoWarning() {
  return (
    <div
      className="rounded-xl px-4 py-3 text-sm leading-relaxed"
      style={{
        border: "1px solid rgba(200,151,26,0.35)",
        background: "rgba(200,151,26,0.08)",
      }}
      role="note"
    >
      <span className="font-semibold text-hi">This page is a demo.</span>{" "}
      <span className="text-mid">
        Figures here use sample pool math. If you created an Ecosystem or Marketing pool, open
        that pool&rsquo;s dashboard — its calculator is tuned to that pool&rsquo;s duration, taxes, and
        funding, and will give a more accurate value.
      </span>
    </div>
  );
}
