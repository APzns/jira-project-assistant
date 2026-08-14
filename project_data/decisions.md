# Decision Log

Chronological record of key program decisions and their rationale.
The assessment agent should treat these as intentional — do not flag a
deliberate trade-off as an unexpected problem.

## D1 — Sprint 1: Lead with Checkout Redesign
- **Decision:** Front-load Checkout Redesign (APS-1) capacity in early
  sprints; ramp Security & Compliance (APS-2) later.
- **Rationale:** Checkout is the larger, higher-uncertainty rebuild and
  benefits from an early start. Compliance work is better understood and
  can be compressed into later sprints.
- **Implication for data:** Expect APS-2 to look under-delivered in
  Sprints 1–2 by design; this is not yet a risk.

## D2 — Sprint 2: Protect compliance timeline over minor scope
- **Decision:** Deprioritized fix-versions/release-tagging work to preserve
  capacity for the fixed compliance deadline.
- **Rationale:** The compliance deadline is external and immovable (see R1);
  release-tagging is internal and can be caught up later.
- **Implication for data:** Sprint 2 velocity dipped to 153 partly due to
  this reprioritization, not purely a capacity failure.

## D3 — Sprint 2: Freeze Checkout Redesign scope
- **Decision:** No new stories added to APS-1 after Sprint 2 without PM
  sign-off.
- **Rationale:** Mitigates scope-creep risk (R4) and protects compliance
  capacity.
- **Implication for data:** Growth in APS-1 issue count after Sprint 2 would
  indicate the freeze was broken and should be flagged.
