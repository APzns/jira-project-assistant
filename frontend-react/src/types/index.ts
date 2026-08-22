/* ============================================================================
 * types/index.ts — Shared TypeScript interfaces for the Jira Project Assistant
 * Derived from backend Pydantic models and frontend rendering logic.
 * ========================================================================== */

// ---------------------------------------------------------------------------
// Assessment (from /api/assess and /api/assess/latest)
// ---------------------------------------------------------------------------

export interface MilestoneCompletion {
  done?: number;
  total?: number;
  percent_done?: number;
  release_date?: string;
  days_to_release?: number;
}

export interface AssessmentMilestone {
  name: string;
  status: string; // "on_track" | "at_risk" | "delayed" | "completed"
  assessment?: string;
}

export interface AssessmentRisk {
  finding: string;
  severity?: string; // "low" | "medium" | "high" | "critical"
  evidence: string;
  lens?: string;
}

export interface SprintProgress {
  sprint: string;
  state: string; // "closed" | "active" | "future"
}

export interface PointsBySprintTeam {
  sprints: string[];
  teams: string[];
  committed: Record<string, number[]>;
  completed: Record<string, number[]>;
}

export interface OvercommitNext {
  pct?: number;
}

export interface DefectsRatio {
  pct?: number;
  overall?: string;
}

export interface DependencyConflictItem {
  key?: string;
  blocker?: string;
  blocker_team?: string;
  blocker_summary?: string;
  blocker_sprint?: string;
  blocker_sprint_end?: string;
  blocked?: string;
  blocked_team?: string;
  blocked_summary?: string;
  blocked_sprint?: string;
  blocked_sprint_end?: string;
  summary?: string;
  reason?: string;
}

export interface DependencyConflicts {
  count?: number;
  items?: DependencyConflictItem[];
}

export interface DelayedIssue {
  key: string;
  summary?: string;
  team?: string;
  delay_days: number;
}

export interface DelayedVersion {
  fix_version: string;
  release_date?: string;
  delayed_count: number;
  issues: DelayedIssue[];
}

export interface DelayedByFixVersion {
  unreleased?: DelayedVersion[];
  released?: DelayedVersion[];
}

export interface CriticalPathItem {
  key: string;
  summary?: string;
  status?: string;
}

export interface CriticalPath {
  critical_keys?: string[];
  chain?: CriticalPathItem[];
}

export interface ProgressIssue {
  key: string;
  summary: string;
  status?: string;
  status_category?: string;
  issue_type?: string;
  team?: string;
  fixversion?: string;
  release_date?: string;
  sprint_state?: string;
}

export interface Predictability {
  pct?: number;
  overall?: string;
}

export interface MonteCarloData {
  labels?: string[];
  datasets?: Array<{
    label: string;
    data: number[];
    [key: string]: unknown;
  }>;
  forecast?: any[];
  actual?: any[];
  p50_line?: any[];
  p80_line?: any[];
  target_date?: string;
  p50_date?: string;
  p80_date?: string;
  total_scope?: number;
  [key: string]: unknown;
}

export interface AssessmentMetrics {
  milestone_completion?: Record<string, MilestoneCompletion>;
  project_milestone?: Record<string, unknown>;
  predictability?: Predictability;
  team_predictability?: Record<string, unknown>;
  defects_ratio?: DefectsRatio;
  team_defects_ratio?: Record<string, unknown>;
  overcommit_next?: OvercommitNext;
  overcommit_by_team?: Record<string, unknown>;
  blocked_issues?: number;
  cross_team_blockers?: number;
  unresolved_bugs?: number;
  dependency_conflicts?: DependencyConflicts;
  forecast_monte_carlo?: Record<string, unknown>;
  forecast_delay_days?: number;
  delayed_by_fixversion?: DelayedByFixVersion;
  overdue_points_pct?: number;
  sprint_progress?: SprintProgress[];
  progress_issues?: ProgressIssue[];
  points_by_sprint_team?: PointsBySprintTeam;
  critical_path?: CriticalPath;
}

export interface Assessment {
  cached?: boolean;
  overall_status?: string; // "on_track" | "at_risk" | "off_track" | "delayed"
  headline?: string;
  reasoning?: string;
  forecast?: string;
  ai_summary?: string;
  predictability_summary?: string;
  predictability_comment?: string;
  milestones?: AssessmentMilestone[];
  risks?: AssessmentRisk[];
  recommended_actions?: string[];
  metrics?: AssessmentMetrics;
  monte_carlo?: MonteCarloData;
  generated_at?: string;
  mode?: string; // "real" | "synthetic"
  notice?: string;
  warning?: string;
  error?: string;
}

// ---------------------------------------------------------------------------
// AI Settings & Report Profiles (from /api/settings)
// ---------------------------------------------------------------------------

export type StakeholderRole = 'program_manager' | 'executive' | 'engineer';
export type RiskCategory = 'dependency' | 'velocity' | 'overcommitment';
export type RiskSeverity = 'low' | 'medium' | 'high';
export type Verbosity = 'brief' | 'detailed';

export interface ReportProfile {
  id?: string;
  name: string;
  is_default?: boolean;
  stakeholder?: StakeholderRole | string;
  focus_teams?: string[];
  focus_epics?: string[];
  risk_categories?: RiskCategory[];
  min_risk_severity?: RiskSeverity;
  summary_verbosity?: Verbosity;
  custom_instructions?: string;
}

export interface AISettings {
  active_profile_id?: string;
  profiles?: ReportProfile[];
  stakeholder?: StakeholderRole | string;
  focus_teams?: string[];
  focus_epics?: string[];
  risk_categories?: RiskCategory[];
  min_risk_severity?: RiskSeverity;
  summary_verbosity?: Verbosity;
  custom_instructions?: string;
}

export interface SaveSettingsResponse {
  saved: boolean;
  settings: AISettings;
}

export interface ResetSettingsResponse {
  reset: boolean;
  settings: AISettings;
}

// ---------------------------------------------------------------------------
// Stakeholders (from /api/stakeholders)
// ---------------------------------------------------------------------------

export interface StakeholderProfile {
  id?: string;
  name: string;
  role_type: string;
  is_builtin: boolean;
  description: string;
  project_override?: string;
}

export interface StakeholdersData {
  stakeholders: StakeholderProfile[];
}

export interface SaveStakeholdersResponse {
  saved: boolean;
  data: StakeholdersData;
}

// ---------------------------------------------------------------------------
// Report Templates (from /api/reports)
// ---------------------------------------------------------------------------

export interface ReportBlock {
  id: string;
  block_type: string;
  title: string;
  enabled: boolean;
  order: number;
  pm_commentary?: string;
  chart_prompt?: string;
  config?: Record<string, unknown>;
}

export interface ReportTemplate {
  id?: string;
  name: string;
  description?: string;
  is_default: boolean;
  stakeholder_ids: string[];
  stakeholder_notes?: string;
  target_deadline?: string;
  sprint_cadence_days?: number;
  focus_teams?: string[];
  focus_epics?: string[];
  blocks: ReportBlock[];
  created_at?: string;
  updated_at?: string;
}

export interface ReportsData {
  templates: ReportTemplate[];
}

export interface SaveReportsResponse {
  saved: boolean;
  data: ReportsData;
}

// ---------------------------------------------------------------------------
// Composer Block Definitions (frontend-only, used by Report Composer UI)
// ---------------------------------------------------------------------------

export interface ComposerBlockDef {
  id: string;
  type: string;
  title: string;
  hasChart: boolean;
}

export const AVAILABLE_BLOCKS: ComposerBlockDef[] = [
  { id: 'exec_summary', type: 'executive_summary', title: 'Executive AI Summary', hasChart: false },
  { id: 'health_kpis', type: 'health_kpis', title: 'KPI Health', hasChart: false },
  { id: 'burndown', type: 'burndown', title: 'Burndown & Velocity', hasChart: true },
  { id: 'monte_carlo', type: 'monte_carlo', title: 'Monte Carlo Throughput Forecast', hasChart: true },
  { id: 'dependency_matrix', type: 'dependency_matrix', title: 'Team Dependencies Matrix', hasChart: true },
  { id: 'quality_defects', type: 'quality_defects', title: 'Defect Ratio by Team', hasChart: true },
  { id: 'action_plan', type: 'action_plan', title: 'P1-P3 Action Plan', hasChart: false },
];

// ---------------------------------------------------------------------------
// Skills (from /api/skills/*)
// ---------------------------------------------------------------------------

export interface SkillRequest {
  context?: string;
  profile_id?: string;
  template_id?: string;
  custom_instructions?: string;
  settings_override?: Record<string, unknown>;
  // Report-composer fields passed by readPaSettingsForm
  name?: string;
  description?: string;
  stakeholder_ids?: string[];
  stakeholder_notes?: string;
  blocks?: ReportBlock[];
}

/** analyze-status response */
export interface AnalyzeStatusDelay {
  area: string;
  description: string;
  predictive_completion?: string;
  confidence?: string;
}

export interface SkillRisk {
  title: string;
  severity: string;
  area?: string;
  evidence?: string;
  impact?: string;
  mitigation: string;
}

export interface AnalyzeStatusResponse {
  skill: 'analyze-status';
  settings_applied: Record<string, unknown>;
  summary: string;
  delays: AnalyzeStatusDelay[];
  risks: SkillRisk[];
  program_health?: string;
  forecast_summary?: string;
}

/** propose-next-steps response */
export interface NextStepAction {
  title: string;
  priority: string; // "P1" | "P2" | "P3"
  owner?: string;
  rationale: string;
}

export interface ProposeNextStepsResponse {
  skill: 'propose-next-steps';
  settings_applied: Record<string, unknown>;
  actions: NextStepAction[];
  summary?: string;
}

/** generate-report response */
export interface ReportMilestone {
  name: string;
  status: string;
  progress: string;
  forecast?: string;
  details: string;
}

export interface ReportRecommendation {
  priority: string; // "P1" | "P2" | "P3"
  title: string;
  owner?: string;
  action: string;
  rationale?: string;
}

export interface VelocityAndCapacity {
  predictability?: string;
  capacity_drag?: string;
  observations?: string;
}

export interface GenerateReportResponse {
  skill: 'generate-report';
  settings_applied: Record<string, unknown>;
  profile_used?: string;
  generated_at?: string;
  title: string;
  executive_summary: string;
  overall_status: string;
  program_health_score?: string;
  milestones: ReportMilestone[];
  key_risks: SkillRisk[];
  velocity_and_capacity?: VelocityAndCapacity;
  recommendations: ReportRecommendation[];
}

export type SkillResponse =
  | AnalyzeStatusResponse
  | ProposeNextStepsResponse
  | GenerateReportResponse;

// ---------------------------------------------------------------------------
// Ask (from /api/ask)
// ---------------------------------------------------------------------------

export interface AskResponse {
  answer: string;
  sources?: string[];
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Generic API Error
// ---------------------------------------------------------------------------

export interface ApiError {
  detail?: string;
  error?: string;
  message?: string;
}

export interface ProjectData {
  key: string;
  name: string;
  status: string;
  description: string;
  progress: number;
  sp_completed?: number;
  sp_total?: number;
  tags: string[];
  blockers: string[] | number;
  targetRelease: string;
}

export interface ProjectSetting {
  key: string;
  name: string;
  description: string;
  target_release?: string;
  tags?: string;
  ai_guidelines?: string;
  at_risk_blockers?: number;
  at_risk_delay_days?: number;
}