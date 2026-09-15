# Source Audit — `programs/staking` (Solana/Anchor)

**Scope:** the Rust source in `programs/staking/src` and `crates/staking-math`,
as present in this repository.
**Not in scope / NOT verified:** whether any deployed on-chain bytecode matches
this source; on-chain runtime concerns (compute-unit limits, account-reload
races, rent); the frontend in `app/`.
**Method:** manual review + comparison against the repo's own executable
specification (`crates/staking-math/src/pool.rs`, `RefPool`), which the codebase
itself treats as the source of truth. Several findings are differences between
the on-chain handlers and that reference model.

> Important caveat: I cannot audit the *live* program from here. I do not have a
> confirmed program ID + cluster, and verifying source-to-bytecode requires a
> reproducible Anchor build (`solana-verify`). Everything below is about the
> source as written. If you provide the deployed address and cluster, I can
> additionally fetch publicly observable on-chain metadata (upgrade authority,
> program data, deploy slot) via RPC — but that reads bytecode, not logic.

---

## Findings summary

| ID | Severity | Title | Status |
|----|----------|-------|--------|
| H-1 | High | Double-claim / repeat-settlement over-payment for matured positions | **FIXED** |
| H-2 | High | Crank applied tenure weight increment before distributing the hour's emission | **FIXED** |
| M-1 | Medium | `withdraw_unallocated` grace period was caller-supplied, not fixed | **FIXED** |
| M-2 | Medium | Per-hour emission flooring leaks dust vs. the cumulative spec | Documented (safe by design) |
| L-1 | Low | Dead/misleading `handler_propose_authority` code | **FIXED** (removed) |
| L-2 | Low | Sweep comment/error said "12 hours" but constant is 3 hours | **FIXED** |
| I-1 | Info | `unstake` staleness gate can trap principal if the pool is un-cranked | Documented (mitigated by permissionless crank) |

### Fixes applied (this repo)

- **H-1:** introduced `instructions/accrual_helpers.rs` with a single
  `boundary_sum_baseline()` used by BOTH `compute_pending` and `write_snapshot`,
  so `sum_acc_snapshot` is the same `G_{n0+min(k,72)}` the read-back uses. All
  four handlers (`stake`, `unstake`, `claim`, `compound`) now call
  `write_snapshot`. A repeat settlement with no elapsed time now telescopes to
  zero. Verified by the EVM differential "double claim pays zero" test.
- **H-2:** reordered `crank.rs` so each boundary's emission is distributed and
  the `(A_n, G_n)` checkpoint recorded at the pre-increment weight, then
  `total_weight += ramping_stake` and the maturing cohort pop happen. This
  matches `RefPool::advance_bounded_with` exactly. The EVM crank and JS oracle
  were reordered to match; all 45 EVM tests and 90 Rust reference tests pass.
- **M-1:** added `UNALLOCATED_GRACE_SECONDS = 7 days` constant; removed the
  `grace_period` argument from `withdraw_unallocated` (both `lib.rs` entrypoint
  and `admin.rs` handler). EVM `withdrawUnallocated` likewise uses a fixed
  constant.
- **L-1:** removed the dead `handler_propose_authority`.
- **L-2:** corrected the "12 hours" comments and the `SweepTooEarly` message to
  "3 hours".

The reference model (`crates/staking-math`) was intentionally left unchanged: it
was already correct and serves as the specification the fixes were validated
against.

---

## Original findings (detail)

---

## H-1 — Repeat settlement over-pays a matured position

**Where:** `instructions/claim.rs`, `stake.rs`, `unstake.rs`, `compound.rs`
(the re-snapshot blocks).

**What:** After settling, the handlers store

```rust
position.snapshot_k        = k_now;                     // capped at 72
position.acc_snapshot      = pool.acc_reward_per_weight; // global A
position.sum_acc_snapshot  = pool.sum_acc_at_boundaries; // global G  <-- bug
```

but the accrual formula (`accrual_bracket`) later reads the boundary baseline as

```
g_k = checkpoints[n0 + capped_steps(k)].sum_acc      // == G_{n0+72} for a matured position
```

and computes `... - (g_k - snap.sum_acc)`. For a matured position, `k` is frozen
at 72 while the global boundary index keeps advancing, so
`g_k = G_{n0+72} != G_global = snap.sum_acc`. The boundary-correction term does
**not** telescope to zero on a repeat settlement with no elapsed time. The next
`claim` therefore pays out an extra `(G_global − G_{n0+72}) * 144 * stake /
ACC_SCALE`.

**Impact:** a matured staker can claim, then immediately claim again for a
nonzero amount, repeatedly, draining the reward vault. This contradicts the
handler's own doc comment ("Double-claim pays zero").

**Evidence:** the repo's reference model does it correctly —
`pool.rs::settle` snapshots `sum_acc: g_k` (the checkpoint value), not the global
`sum_acc`. In the EVM port, the differential test `Differential.test.js` →
"double claim pays zero" fails against the faithful (buggy) port and passes after
snapshotting the consistent `g_k` baseline.

**Fix:** snapshot the boundary baseline consistent with `k`, i.e.
`sum_acc_snapshot = checkpoints[n0 + capped_steps(k)].sum_acc` (fall back to the
global value only when that boundary has not yet been recorded). Apply at every
re-snapshot site: `stake`, `unstake` (k=0), `claim`, `compound` (both paths).

---

## H-2 — Crank increments ramping weight before distributing emission

**Where:** `instructions/crank.rs`, the per-boundary loop.

**What:** the on-chain order per boundary `n` is:

1. `total_weight += ramping_stake`   (ramping positions gain their step)
2. `ramping_stake -= maturing[n]`
3. compute `emission`, then `A += emission * ACC_SCALE / total_weight`
4. record checkpoint `(A, G)`

The reference model (`pool.rs::advance_bounded_with`) does the opposite order:

1. accrue the segment into `A` using the **pre-increment** `total_weight`
2. record checkpoint
3. `total_weight += ramping_stake`
4. `ramping_stake -= maturing[n]`

**Impact:** the on-chain crank credits each hour's emission at the *incremented*
weight, i.e. ramping positions begin earning their higher tenure weight one
hourly step earlier than the specification says. This is a systematic
per-user distribution divergence from the executable spec across the whole
program. It does not overdraw the pool (shares still sum to ≤ 1), but it means
the on-chain payout curve is not the one the `RefPool` model and its property
tests validate.

**Evidence:** direct diff of the two loops (see the ordering comments in
`crank.rs`, which themselves waver on the correct order, and the settled order in
`pool.rs`).

**Fix / decision needed:** decide which order is canonical. If the reference
model is the spec, move the `total_weight += ramping_stake` and
`ramping_stake -= maturing[n]` to *after* the emission distribution and
checkpoint recording for boundary `n`. Then re-run the `RefPool` equivalence and
`golden` tests. (Note: the boundary/`G_n` semantics that H-1's fix depends on
must be re-checked jointly with this change, since both touch what `G_{n0+k}`
means.)

---

## M-1 — `withdraw_unallocated` grace period is caller-supplied

**Where:** `instructions/admin.rs::handler_withdraw_unallocated(amount, grace_period)`.

**What:** the gate is `now > end_ts + grace_period`, where `grace_period` is an
**argument passed by the admin at call time**, not a fixed constant. The admin
can pass `grace_period = 0` (or any value) to minimise the wait.

**Impact:** the "grace period" is not a protocol guarantee to stakers; it is at
the admin's discretion. If the intent was a fixed cooldown protecting late
claimers, this does not enforce it. Since only `unallocated` (zero-TVL emissions,
never owed to any staker) can be withdrawn, the blast radius is limited — but the
guarantee is weaker than it appears.

**Fix:** make the grace period a compile-time constant (or a value fixed at
`initialize_pool`), not a per-call argument.

---

## M-2 — Per-hour emission flooring leaks dust vs. the cumulative spec

**Where:** `crank.rs` step 3 vs. `emission.rs::cumulative_emitted`.

**What:** `crank` floors each hour independently
(`base_rate * 3 * mult / 12`), while the spec's `cumulative_emitted` floors once
against a cumulative numerator. Over 336 hourly boundaries the per-hour form
under-emits by a bounded amount (measured ~0.15% of total for a single
minimum-size position in the EVM port).

**Impact:** always floors toward the pool (pool cannot be overdrawn), so this is
safe, but it means `total_emitted` never reaches `base_rate * DENOM`, and a
small residual is permanently trapped as sweepable/withdrawable surplus. The
`golden`/`pool_behaviour` tests that assert `total_emitted == r0 * DENOM` hold
for the reference model but **not** for the on-chain crank.

**Fix:** either (a) accept and document it (it is safe), or (b) switch the crank
to cumulative-numerator accounting to match the spec exactly.

---

## L-1 — Dead/misleading authority-proposal handler

**Where:** `admin.rs::handler_propose_authority`.

The function's body is a long comment debating the design and then just emits a
log; it changes no state and is not wired into `lib.rs`. The actual transfer is
`handler_transfer_authority` (two-signer). Remove the dead handler to avoid
confusion.

## L-2 — Sweep comment says 12 hours; constant is 3 hours

**Where:** `sweep_to_operator.rs` doc comments vs. `lib.rs::EMPTY_SWEEP_SECONDS`.

The doc comment repeatedly says "12 hours" / "12h", but
`EMPTY_SWEEP_SECONDS = 3 * 60 * 60` (3 hours), and the code uses the constant.
Behaviour is 3 hours; fix the comments (or the constant, if 12h was intended).

## I-1 — Staleness gate blocks unstake when un-cranked

**Where:** `unstake.rs` staleness `require!`.

`unstake` requires the pool to be cranked within one tenure step. If nobody
cranks, a user cannot withdraw principal until someone does. Crank is
permissionless, so any user (including the withdrawer, in a prior instruction)
can crank first; this is a UX/operational note, not a lockup — but front-ends
must crank-then-unstake atomically or users may see failures.

---

## What I verified vs. did not

**Verified (source-level, with the reference model and EVM differential tests):**
- H-1 reproduces and is fixed by the `g_k` snapshot; covered by a passing
  double-claim differential test in the EVM port.
- H-2 is a direct, unambiguous ordering difference between the two loops.
- M-1, L-1, L-2 are direct reads of the source.
- M-2 magnitude measured empirically in the EVM oracle (~0.15% for one min position).

**NOT verified:**
- Whether any live program matches this source (no confirmed program ID/cluster,
  no reproducible-build verification).
- On-chain runtime behavior: compute-unit exhaustion during large cranks,
  `reload()` correctness under all CPI paths, rent/ATA edge cases,
  Token-2022 extension parsing against adversarial mints beyond the listed set.
- Economic review of the emission schedule's intended shape.

To extend this into a live-deployment audit, provide: the program ID, the
cluster, and confirmation of the build toolchain (Anchor/solana versions), and
I can fetch on-chain metadata and outline a verified-build procedure.
