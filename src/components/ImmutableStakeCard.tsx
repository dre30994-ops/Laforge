export function ImmutableStakeCard() {
  return (
    <section className="glass p-6 animate-rise" data-testid="immutable-stake-card">
      <p className="label-term mb-2">How a pool is born</p>
      <h2 className="mt-1 text-3xl md:text-4xl font-semibold tracking-tight leading-tight hero-title-gold">
        Locked in at creation.
      </h2>
      <p className="mt-3 text-sm text-mid leading-relaxed">
        When a stake is created, the token, duration, taxes, and treasury are written on-chain
        and do not change. That immutability is the point — stakers can read the terms once and
        trust them for the life of the pool, and the people who join it form a community around
        a contract that cannot quietly rewrite the deal.
      </p>
      <p className="mt-3 text-sm text-mid leading-relaxed">
        Creators earn from the stake and unstake taxes they choose. Every taxed action pays the
        treasury they set at launch. No treasury means no tax, and no income from the pool.
      </p>
    </section>
  );
}
