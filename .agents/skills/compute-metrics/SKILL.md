---
name: compute-metrics
description: Calculates core program metrics including sprint predictability, team velocity, defect ratios, dependency conflict counts, and Monte Carlo throughput projections.
---

# Skill: Compute Program Metrics

This skill calculates quantitative health and delivery metrics for the requested project or portfolio from PostgreSQL sprint and issue tables.

## Metrics Formulations

### 1. Sprint Predictability
- **Definition**: Ratio of completed story points to committed story points in closed sprints.
- **Formula**: `Predictability = (Completed SP in Sprint) / (Committed SP in Sprint)`
- **Benchmark**: > 80% is considered on track; < 65% signals high delivery volatility.

### 2. Team Velocity
- **Definition**: Average story points completed per sprint over closed sprints.
- **Usage**: Used as baseline capacity to detect upcoming sprint overcommitment.

### 3. Sprint Overcommitment
- **Definition**: Ratio of committed story points in an upcoming/active sprint compared to average historical velocity.
- **Formula**: `Overcommitment % = ((Committed SP - Avg Velocity) / Avg Velocity) * 100`

### 4. Defect Ratio
- **Definition**: Percentage of closed sprint story points spent resolving bugs/technical debt.
- **Formula**: `Defect Ratio = (Bug & Tech Debt SP) / (Total Completed SP)`

### 5. Monte Carlo Completion Simulation
- **Definition**: Statistical simulation (500+ iterations) of remaining program backlog completion dates based on historical daily/sprint throughput distributions.
- **Outputs**: P50 (median anticipated completion date) and P85 (high-confidence completion date).
