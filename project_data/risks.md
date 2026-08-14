# Risk Lenses

The assessment agent examines the program through these lenses and writes its
own findings. This file describes WHAT to look at, not fixed verdicts — the
agent decides whether something is a risk, how severe it is, and what it means,
using the script-computed metrics as evidence. It never computes numbers
itself; the numbers are provided.

## Milestone deadline slip
Each milestone (Jira Fix Version) has a completion percentage and a release
date. A milestone is at risk when its completion is not tracking toward 100% in
the time remaining before its release date — e.g. low completion with little
time left, or a later milestone already lagging. Consider both how far along
the work is and how much runway remains.

## Project deadline slip
The project's final milestone (the one with the latest release date — the
launch / go-live milestone) represents the overall delivery date. This lens
asks whether the project as a whole is forecast to ship on time: is the final
milestone's completion trajectory, plus the state of everything feeding it,
consistent with hitting its release date? A slip here is the headline risk.

## Dependency risk
Blocking dependencies threaten delivery. Look at how much work is blocked
overall, and — as a distinct concern — how many blocks cross team boundaries,
since cross-team blocks require coordination outside any single team's control.
Also consider whether a blocker is behind schedule while the work depending on
it is due soon (a blocker in an earlier or current sprint holding up work whose
sprint is imminent), which turns a dependency into a schedule threat.
