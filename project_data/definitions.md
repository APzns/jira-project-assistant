
# Definitions & Rules of Thumb

Use these when assessing project health.

- **On track:** All active milestones' success criteria are trending toward
  being met by their target; no triggered critical risks.
- **At risk:** One or more risk triggers are met, or a milestone is unlikely
  to be met without intervention.
- **Off track:** A critical risk (e.g. R1 compliance) is realized, or a
  milestone will clearly be missed.
- **Epic at risk:** Less than 70% of its issues Done when it is within one
  sprint of its milestone.
- **Healthy velocity:** 160–190 story points per sprint. Below 160 is a
  concern; sustained decline across sprints is a red flag.
- **Done:** status_category = 'Done'.
- **Open critical bug:** issue_type = 'Bug', priority in (High, Highest),
  status_category != 'Done'.
- **Overdue:** due_date in the past and status_category != 'Done'.
