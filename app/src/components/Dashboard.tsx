"use client";

import {
  EMISSION_RAMP_DAYS,
  EMISSION_STEP_SECONDS,
  formatCountdown,
  formatTokens,
  projectRewards,
  usePoolStats,
} from "@/lib/economics";

// ─── LEFT HALF: Hero + Milestones + Pool Stats ───

export function DashboardLeft() {
  const stats = usePoolStats();
  const elapsed = stats.now - stats.startTs;
  const totalDuration = stats.endTs - stats.startTs;
  const progress = Math.min(100, (elapsed / totalDuration) * 100);
  const plateauTs = stats.startTs + EMISSION_RAMP_DAYS * 86400;
  const timeToDay3 = Math.max(0, plateauTs - stats.now);
  const timeToEnd = Math.max(0, stats.endTs - stats.now);

  return (
    <div className="space-y-4 animate-fade-in">
      {/* Hero */}
      <div className="card-medieval glow-border text-center py-5">
        <h1 className="text-2xl font-medieval font-bold text-gold-300 tracking-wide">
          ⚔ The Staking Forge ⚔
        </h1>
        <p className="text-medieval-muted font-body text-sm mt-1">
          Stake your tokens. Forge your destiny.
        </p>
        <div className="mt-4 max-w-xs mx-auto">
          <div className="flex justify-between text-[10px] text-medieval-muted mb-1">
            <span>Day {Math.floor(elapsed / 86400) + 1}</span>
            <span>{progress.toFixed(1)}%</span>
          </div>
          <div className="progress-bar">
            <div className="progress-fill" style={{ width: `${progress}%` }} />
          </div>
        </div>
      </div>

      {/* Milestones */}
      <div className="grid grid-cols-2 gap-3">
        <div className="card-medieval !p-3">
          <div className="stat-label text-[10px]">Day {EMISSION_RAMP_DAYS} Plateau</div>
          <div className="text-sm font-medieval text-gold-300">
            {timeToDay3 > 0 ? formatCountdown(timeToDay3) : "✓ Reached"}
          </div>
        </div>
        <div className="card-medieval !p-3">
          <div className="stat-label text-[10px]">Program End</div>
          <div className="text-sm font-medieval text-gold-300">
            {formatCountdown(timeToEnd)}
          </div>
        </div>
      </div>

      {/* Pool stats */}
      <div className="grid grid-cols-2 gap-3">
        <StatCard label="TVL" value={formatTokens(stats.tvl)} />
        <StatCard label="Rate / 20min" value={formatTokens(stats.currentRate)} sub="varies w/ TVL" />
        <StatCard label="Emission Mult" value={`${stats.emissionMultiplier.toFixed(2)}x`} />
        <StatCard label="Pool Left" value={formatTokens(stats.remaining)} />
      </div>
    </div>
  );
}

// ─── RIGHT HALF: Your Position + Tick Counters ───

export function DashboardRight() {
  const stats = usePoolStats();
  const elapsed = stats.now - stats.startTs;

  const hoursSinceStart = Math.floor(elapsed / 3600);
  const nextTenureTick = stats.startTs + (hoursSinceStart + 1) * 3600;
  const timeToTenureTick = Math.max(0, nextTenureTick - stats.now);

  const stepsElapsed = Math.floor(elapsed / EMISSION_STEP_SECONDS);
  const nextEmissionStep = stats.startTs + (stepsElapsed + 1) * EMISSION_STEP_SECONDS;
  const timeToEmissionStep = Math.max(0, nextEmissionStep - stats.now);

  // Estimated daily reward for the live position, via the shared model so it
  // stays consistent with the calculator.
  const dailyProjection = projectRewards({
    stake: stats.yourStake,
    tvl: stats.tvl,
    baseRatePerTick: stats.currentRate,
    emissionMultiplier: stats.emissionMultiplier,
    tenureMultiplier: stats.yourMultiplier,
    poolAvgMultiplier: stats.poolAvgMultiplier,
    horizonDays: 1,
  });

  return (
    <div className="space-y-4 animate-fade-in">
      {/* Your Position */}
      <div className="card-medieval glow-border">
        <h2 className="text-lg font-medieval text-gold-300 mb-3">Your Position</h2>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <div className="stat-label text-[10px]">Staked</div>
            <div className="text-lg font-medieval font-bold text-gold-300">
              {formatTokens(stats.yourStake)}
            </div>
          </div>
          <div>
            <div className="stat-label text-[10px]">Multiplier</div>
            <div className="text-lg font-medieval font-bold text-gold-300">
              {stats.yourMultiplier.toFixed(2)}x
            </div>
            <TenureBar multiplier={stats.yourMultiplier} />
          </div>
          <div>
            <div className="stat-label text-[10px]">Pending Rewards</div>
            <div className="text-lg font-medieval font-bold text-green-400">
              {formatTokens(stats.yourPending)}
            </div>
          </div>
          <div>
            <div className="stat-label text-[10px]">Est. Daily</div>
            <div className="text-lg font-medieval font-bold text-gold-300">
              {formatTokens(dailyProjection.dailyReward)}
            </div>
            <div className="text-[10px] text-medieval-muted">varies w/ TVL</div>
          </div>
        </div>
      </div>

      {/* Tick Counters */}
      <div className="grid grid-cols-2 gap-3">
        <div className="card-medieval !p-3 text-center">
          <div className="stat-label text-[10px]">Tenure Tick</div>
          <div className="text-sm font-medieval text-parchment-200">
            {Math.floor(timeToTenureTick / 60)}m {Math.floor(timeToTenureTick % 60)}s
          </div>
          <div className="text-[9px] text-medieval-muted">hourly</div>
        </div>
        <div className="card-medieval !p-3 text-center">
          <div className="stat-label text-[10px]">Emission Step</div>
          <div className="text-sm font-medieval text-parchment-200">
            {formatCountdown(timeToEmissionStep)}
          </div>
          <div className="text-[9px] text-medieval-muted">{EMISSION_STEP_SECONDS / 3600}-hourly</div>
        </div>
      </div>

      {/* Pool avg vs yours */}
      <div className="card-medieval !p-3">
        <div className="flex justify-between items-center">
          <div>
            <div className="stat-label text-[10px]">Pool Avg Mult</div>
            <div className="text-sm font-medieval text-medieval-muted">
              {stats.poolAvgMultiplier.toFixed(2)}x
            </div>
          </div>
          <div className="text-right">
            <div className="stat-label text-[10px]">Your Mult</div>
            <div className="text-sm font-medieval text-gold-300">
              {stats.yourMultiplier.toFixed(2)}x
            </div>
          </div>
        </div>
        <div className="text-[9px] text-medieval-muted text-center mt-2 italic">
          Rate can rise if the operator tops up
        </div>
      </div>
    </div>
  );
}

// ─── Shared small components ───

function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="card-medieval !p-3 text-center">
      <div className="stat-label text-[10px]">{label}</div>
      <div className="text-sm font-medieval font-bold text-gold-300">{value}</div>
      {sub && <div className="text-[9px] text-medieval-muted">{sub}</div>}
    </div>
  );
}

function TenureBar({ multiplier }: { multiplier: number }) {
  const pct = Math.min(100, ((multiplier - 1) / 1) * 100);
  return (
    <div className="progress-bar mt-1">
      <div className="progress-fill" style={{ width: `${pct}%` }} />
    </div>
  );
}

// Keep a default export for backward compat
export function Dashboard() {
  return (
    <>
      <DashboardLeft />
      <DashboardRight />
    </>
  );
}
