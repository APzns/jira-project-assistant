"""
profiles.py — Domain Dataset Profiles for seeding distinct Jira projects.

Provides domain-specific presets (e-commerce, platform, mobile, AI/ML, fintech, general)
so different projects can be populated with realistic, distinct Epics, FixVersions,
sprints, stories, tasks, and bugs.
"""

from dataclasses import dataclass
from typing import Dict, List


@dataclass
class FixVersionSpec:
    name: str
    days_offset: int  # days relative to now for release date
    description: str


@dataclass
class EpicSpec:
    summary: str
    description: str
    fix_version_name: str  # maps to FixVersionSpec.name


@dataclass
class SprintSpec:
    name: str
    goal: str
    weeks_offset_start: int  # relative to now
    weeks_duration: int = 2
    state: str = "future"   # closed, active, future


@dataclass
class DomainProfile:
    name: str
    display_title: str
    epics: List[EpicSpec]
    fix_versions: List[FixVersionSpec]
    sprints: List[SprintSpec]
    verbs: Dict[str, List[str]]
    subjects: List[str]
    labels: List[str]
    bug_topics: List[str]


# ---------------------------------------------------------------------------
# Profile: E-Commerce & Checkout (Default for CHK / PAY / SHOP)
# ---------------------------------------------------------------------------
ECOMMERCE_PROFILE = DomainProfile(
    name="ecommerce",
    display_title="E-Commerce & Global Checkout",
    fix_versions=[
        FixVersionSpec("v1.0.0-alpha", -14, "Initial checkout redesign alpha release"),
        FixVersionSpec("v1.2.0-beta", 14, "Multi-gateway failover & Apple Pay beta"),
        FixVersionSpec("v2.0.0-GA", 60, "Global multicurrency & localized checkout GA"),
    ],
    epics=[
        EpicSpec("Checkout Flow Redesign", "Streamlining one-click purchase and payment UI", "v1.0.0-alpha"),
        EpicSpec("Payment Gateway Failover", "Automated fallback between Stripe, Adyen, and PayPal", "v1.2.0-beta"),
        EpicSpec("Multicurrency & FX Engine", "Real-time FX conversion and localized payment methods", "v2.0.0-GA"),
        EpicSpec("Cart & Inventory Reservation", "High-concurrency lock-free cart stock holding", "v1.0.0-alpha"),
        EpicSpec("Fraud & Risk Scoring", "Pre-auth risk score evaluation and 3D-Secure 2.0 triggers", "v1.2.0-beta"),
        EpicSpec("Post-Purchase & Invoicing", "Instant PDF receipts, tax calculation, and refund workflows", "v2.0.0-GA"),
    ],
    sprints=[
        SprintSpec("Sprint 1 - Foundation", "Checkout state machine & cart API", -4, 2, "closed"),
        SprintSpec("Sprint 2 - Payment Gateways", "Stripe & Adyen failover integration", -2, 2, "closed"),
        SprintSpec("Sprint 3 - 1-Click & Wallets", "Apple Pay, Google Pay, and localized checkout", 0, 2, "active"),
        SprintSpec("Sprint 4 - FX & Tax Engine", "Real-time tax calculation and currency conversion", 2, 2, "future"),
    ],
    verbs={
        "Story": ["As a shopper I want to", "Enable", "Support", "Allow users to", "Streamline"],
        "Task": ["Integrate", "Configure", "Refactor", "Optimize", "Audit"],
        "Bug": ["Fix race condition in", "Resolve 500 error on", "Payment fails during", "Fix broken redirect in"],
        "Feature": ["Launch", "Introduce", "Roll out", "Build express"],
    },
    subjects=[
        "Apple Pay express checkout sheet", "Stripe webhook retry worker",
        "3D-Secure 2.0 challenge modal", "Cart item reservation timeout",
        "Multi-currency exchange rate cache", "Guest checkout address autocomplete",
        "Saved credit card tokenization", "Dynamic shipping rate calculator",
        "Discount code validation engine", "Post-purchase webhook notifications",
        "One-click repeat order button", "PayPal Smart Button integration",
    ],
    labels=["checkout", "payments", "pci-dss", "frontend", "mobile-web", "latency"],
    bug_topics=[
        "Cart price mismatch when changing currency",
        "Duplicate authorization charge on double-click",
        "Expired session causes blank checkout page",
        "Stripe webhook payload signature failure",
    ],
)


# ---------------------------------------------------------------------------
# Profile: Platform Core & Infrastructure (Default for CORE / INF / OPS)
# ---------------------------------------------------------------------------
PLATFORM_PROFILE = DomainProfile(
    name="platform",
    display_title="Platform Core & Cloud Infrastructure",
    fix_versions=[
        FixVersionSpec("v2.0.0-preview", -20, "Kafka streaming & base microservices foundation"),
        FixVersionSpec("v2.5.0-rc1", 10, "PostgreSQL partitioning & Redis cluster rollout"),
        FixVersionSpec("v3.0.0-GA", 55, "Unified telemetry, OpenTelemetry, and multi-region failover"),
    ],
    epics=[
        EpicSpec("Kafka Event Streaming Backbone", "Unified event bus for cross-service domain events", "v2.0.0-preview"),
        EpicSpec("PostgreSQL Horizontal Partitioning", "Time-series table partitioning and query optimization", "v2.5.0-rc1"),
        EpicSpec("Kubernetes Cluster Mesh & Scaling", "Automated HPA, Istio service mesh, and zero-downtime deploys", "v2.0.0-preview"),
        EpicSpec("Unified Observability & Tracing", "OpenTelemetry distributed tracing and Prometheus alerting", "v3.0.0-GA"),
        EpicSpec("Distributed Cache & Rate Limiting", "Redis Cluster cache layer with token bucket rate limiting", "v2.5.0-rc1"),
        EpicSpec("Zero-Trust IAM & Secret Rotation", "Vault secret injection and short-lived mTLS certificates", "v3.0.0-GA"),
    ],
    sprints=[
        SprintSpec("Sprint 1 - Event Backbone", "Deploy Kafka cluster and schema registry", -4, 2, "closed"),
        SprintSpec("Sprint 2 - DB Migration", "PostgreSQL connection pooling and partitioning", -2, 2, "closed"),
        SprintSpec("Sprint 3 - Caching & Rate Limits", "Redis cluster deployment and token-bucket middleware", 0, 2, "active"),
        SprintSpec("Sprint 4 - Observability & Tracing", "OpenTelemetry collector and Jaeger mesh tracing", 2, 2, "future"),
    ],
    verbs={
        "Story": ["Enable services to", "Provide API for", "Allow internal clients to", "Standardize"],
        "Task": ["Deploy", "Benchmark", "Upgrade", "Harden", "Migrate", "Configure"],
        "Bug": ["Memory leak in", "Deadlock detected in", "High connection latency on", "Resolve packet drop in"],
        "Feature": ["Implement", "Roll out", "Introduce cluster", "Provision"],
    },
    subjects=[
        "Kafka consumer group rebalancing", "PostgreSQL read-replica replication lag",
        "Redis cluster slot migration script", "gRPC keepalive connection pool",
        "OpenTelemetry distributed span propagator", "Envoy ingress rate-limit filter",
        "Vault dynamic credential lease renewal", "Prometheus alertmanager routing rules",
        "Kubernetes horizontal pod autoscaler thresholds", "Database connection pool exhaustion guard",
        "Elasticsearch index lifecycle policy", "Zero-downtime schema migration runner",
    ],
    labels=["infrastructure", "kafka", "postgres", "redis", "observability", "k8s", "perf"],
    bug_topics=[
        "Kafka lag spike during consumer rebalance",
        "PostgreSQL deadlocks on concurrent upsert",
        "Redis OOM during cache stampede",
        "Prometheus high-cardinality metric saturation",
    ],
)


# ---------------------------------------------------------------------------
# Profile: Mobile Apps & Native UX (Default for MOB / APP / IOS / ANDROID)
# ---------------------------------------------------------------------------
MOBILE_PROFILE = DomainProfile(
    name="mobile",
    display_title="Mobile Apps & Native Experience",
    fix_versions=[
        FixVersionSpec("v1.0.0-testflight", -15, "iOS and Android internal alpha build"),
        FixVersionSpec("v1.5.0-rc", 12, "Biometric auth, offline sync, and push notifications RC"),
        FixVersionSpec("v2.0.0-appstore", 50, "Public App Store and Google Play launch"),
    ],
    epics=[
        EpicSpec("Native Design System & UI Parity", "Unified SwiftUI and Jetpack Compose component library", "v1.0.0-testflight"),
        EpicSpec("Biometric Authentication & Security", "FaceID, TouchID, and Android BiometricPrompt with Secure Enclave", "v1.5.0-rc"),
        EpicSpec("Offline Mode & Local Sync", "SQLite local caching with background delta synchronization", "v1.5.0-rc"),
        EpicSpec("Push Notification Engine", "APNS & FCM rich interactive notifications with deep linking", "v1.0.0-testflight"),
        EpicSpec("App Performance & Battery Optimization", "Frame rate stabilization to 120fps and background task throttling", "v2.0.0-appstore"),
        EpicSpec("Store Release & Telemetry", "Crashlytics, App Store review prompt, and feature flags", "v2.0.0-appstore"),
    ],
    sprints=[
        SprintSpec("Sprint 1 - Core UI & Navigation", "Navigation architecture and design tokens", -4, 2, "closed"),
        SprintSpec("Sprint 2 - Auth & Biometrics", "Secure token storage and biometric unlock", -2, 2, "closed"),
        SprintSpec("Sprint 3 - Offline SQLite Sync", "Delta sync queue and network reachability listener", 0, 2, "active"),
        SprintSpec("Sprint 4 - Notifications & Polish", "APNS push payloads, deep links, and UI audit", 2, 2, "future"),
    ],
    verbs={
        "Story": ["As a mobile user I want to", "Allow user to", "Provide native", "Support"],
        "Task": ["Refactor", "Implement", "Benchmark", "Design", "Optimize"],
        "Bug": ["Fix crash on iOS when", "Resolve UI jitter in", "Memory spike during", "Fix blank screen on"],
        "Feature": ["Launch native", "Build interactive", "Introduce", "Add widget for"],
    },
    subjects=[
        "FaceID biometric login sheet", "Offline SQLite delta sync queue",
        "Deep link universal link router", "Interactive rich push notification banner",
        "Jetpack Compose bottom sheet transition", "SwiftUI liquid pull-to-refresh animation",
        "Keychain secure token wrapper", "App Store review prompt heuristic",
        "Dark mode color palette contrast fix", "Network offline banner toast",
        "Bluetooth sync background scheduler", "Image asset caching and prefetching",
    ],
    labels=["mobile", "ios", "android", "swiftui", "compose", "offline", "biometrics"],
    bug_topics=[
        "App crashes when resumed from background on iOS 18",
        "Android navigation back-stack corrupted after deep link",
        "Offline sync creates duplicate entities",
        "Biometric prompt hangs on cancellation",
    ],
)


# ---------------------------------------------------------------------------
# Profile: AI Platform & Model Engineering (Default for AIP / AI / ML / RAG)
# ---------------------------------------------------------------------------
AI_PLATFORM_PROFILE = DomainProfile(
    name="ai-platform",
    display_title="AI Assistant & LLM Intelligence Platform",
    fix_versions=[
        FixVersionSpec("v0.8.0-poc", -25, "RAG pipeline proof-of-concept and vector database"),
        FixVersionSpec("v1.0.0-beta", 15, "Model orchestration, prompt caching, and evaluation harness"),
        FixVersionSpec("v1.4.0-GA", 60, "Autonomous agent workflows and multi-tenant security GA"),
    ],
    epics=[
        EpicSpec("RAG Retrieval & Vector Embeddings", "Hybrid BM25 + dense vector search with reranking", "v0.8.0-poc"),
        EpicSpec("Model Orchestration & Prompt Routing", "Dynamic model fallback (Gemini Pro / Flash) and semantic cache", "v1.0.0-beta"),
        EpicSpec("AI Safety & Guardrails Engine", "Prompt injection filtering, PII masking, and hallucination scoring", "v1.0.0-beta"),
        EpicSpec("Agentic Tool Execution & Subagents", "Autonomous multi-step tool calls with sandbox execution", "v1.4.0-GA"),
        EpicSpec("Continuous LLM Evaluation Harness", "Automated synthetic benchmark testing and regression detector", "v0.8.0-poc"),
        EpicSpec("Streaming API & Token Telemetry", "Server-Sent Events streaming with token usage rate limiting", "v1.4.0-GA"),
    ],
    sprints=[
        SprintSpec("Sprint 1 - RAG & Vector Index", "Chroma/pgvector setup and chunking strategy", -4, 2, "closed"),
        SprintSpec("Sprint 2 - Routing & Semantic Cache", "Prompt routing middleware and Redis vector cache", -2, 2, "closed"),
        SprintSpec("Sprint 3 - Safety & Guardrails", "PII redaction and adversarial prompt detector", 0, 2, "active"),
        SprintSpec("Sprint 4 - Agent Tools & Streaming", "Dynamic tool dispatch and SSE response streaming", 2, 2, "future"),
    ],
    verbs={
        "Story": ["Enable agent to", "Allow LLM to query", "Provide semantic search for", "Support streaming"],
        "Task": ["Benchmark", "Fine-tune", "Optimize", "Implement", "Evaluate", "Quantize"],
        "Bug": ["Fix token truncation on", "Resolve hallucination in", "High latency on model fallback for", "Fix memory leak in"],
        "Feature": ["Build subagent for", "Introduce vector", "Roll out dynamic", "Deploy evaluation"],
    },
    subjects=[
        "pgvector hybrid HNSW index", "Semantic prompt cache eviction policy",
        "Adversarial prompt injection filter", "PII regex and entity redaction pipeline",
        "Token consumption rate limiter per tenant", "Streaming Server-Sent Events gateway",
        "Cross-encoder reranking latency optimization", "Context window sliding summarizer",
        "Synthetic test set generator for RAG", "Fallback routing between Flash and Pro models",
        "Grounding verification confidence score", "Tool invocation JSON schema validator",
    ],
    labels=["ai", "rag", "llm", "embeddings", "vector-search", "guardrails", "eval"],
    bug_topics=[
        "High prompt token count exceeds model context window",
        "Streaming socket drops connection on long generation",
        "Vector search returns zero results for hyphenated terms",
        "Prompt injection bypasses first-pass safety classifier",
    ],
)


# ---------------------------------------------------------------------------
# Profile: FinTech & Regulatory Compliance (Default for FIN / SEC / GOV)
# ---------------------------------------------------------------------------
FINTECH_PROFILE = DomainProfile(
    name="fintech",
    display_title="FinTech, Security & Compliance Engine",
    fix_versions=[
        FixVersionSpec("v1.1.0-audit-ready", -18, "Audit logging, double-entry ledger, and encryption at rest"),
        FixVersionSpec("v2.0.0-pci-dss", 14, "PCI-DSS Level 1 certification & tokenization vault"),
        FixVersionSpec("v2.4.0-GA", 65, "Automated suspicious activity reporting & AML compliance"),
    ],
    epics=[
        EpicSpec("Immutable Double-Entry Ledger", "Financial accounting ledger with cryptographic hash chaining", "v1.1.0-audit-ready"),
        EpicSpec("Real-Time Fraud & Anomaly Engine", "Streaming fraud heuristic checks and velocity rules", "v2.0.0-pci-dss"),
        EpicSpec("Zero-Trust SSO & Step-Up Auth", "Hardware FIDO2 WebAuthn keys and session risk escalation", "v1.1.0-audit-ready"),
        EpicSpec("Credit Card Tokenization Vault", "Isolated secure enclave for card numbers and CVV validation", "v2.0.0-pci-dss"),
        EpicSpec("AML & Sanctions Screening", "Real-time KYC watchlist and PEP sanctions screening", "v2.4.0-GA"),
        EpicSpec("Regulatory Reporting & Audit Export", "Automated SOC2 compliance reports and immutable export logs", "v2.4.0-GA"),
    ],
    sprints=[
        SprintSpec("Sprint 1 - Ledger Core", "Double-entry schema and transaction isolation", -4, 2, "closed"),
        SprintSpec("Sprint 2 - Auth & Vaulting", "FIDO2 authentication and tokenization service", -2, 2, "closed"),
        SprintSpec("Sprint 3 - Fraud Engine & AML", "Rule engine execution and anomaly detection", 0, 2, "active"),
        SprintSpec("Sprint 4 - Audit & SOC2 Prep", "Immutable audit trails and penetration testing", 2, 2, "future"),
    ],
    verbs={
        "Story": ["Ensure compliance for", "Allow auditors to", "Require step-up auth when", "Validate"],
        "Task": ["Audit", "Harden", "Encrypt", "Verify", "Implement", "Rotate"],
        "Bug": ["Fix rounding error in", "Resolve ledger drift in", "Security vulnerability in", "Fix timing attack in"],
        "Feature": ["Deploy real-time", "Build automated", "Introduce FIDO2", "Roll out compliance"],
    },
    subjects=[
        "Double-entry journal reconciliation check", "FIDO2 WebAuthn step-up auth modal",
        "PCI-DSS card data tokenization proxy", "Real-time fraud rule evaluation latency",
        "Automated SAR suspicious activity exporter", "HMAC webhook verification with nonce validation",
        "AES-256 GCM key rotation schedule", "Sanctions list fuzzy matching algorithm",
        "Zero-trust session invalidation webhook", "Audit log SIEM exporter to Datadog",
        "Ledger balance invariant assertion job", "Cross-border payment fee rounding validator",
    ],
    labels=["fintech", "security", "compliance", "soc2", "pci-dss", "ledger", "fraud"],
    bug_topics=[
        "Ledger debit/credit mismatch on high-frequency transfer",
        "Sanctions screening timeout blocks legitimate transactions",
        "Key rotation worker fails to re-encrypt archived payload",
        "Tokenization vault memory leak under load",
    ],
)


# ---------------------------------------------------------------------------
# Profile: General Software Delivery (Fallback)
# ---------------------------------------------------------------------------
GENERAL_PROFILE = DomainProfile(
    name="general",
    display_title="General Software Delivery & Product Engineering",
    fix_versions=[
        FixVersionSpec("v1.0.0-alpha", -15, "Initial product alpha launch"),
        FixVersionSpec("v1.5.0-beta", 15, "Feature completeness & performance beta"),
        FixVersionSpec("v2.0.0-GA", 60, "Production General Availability release"),
    ],
    epics=[
        EpicSpec("Core Architecture & Foundation", "Base infrastructure, user authentication, and data models", "v1.0.0-alpha"),
        EpicSpec("Feature Delivery & Workflows", "Primary user journeys and product workflows", "v1.5.0-beta"),
        EpicSpec("Performance Hardening & Scale", "Query optimization, caching, and load testing", "v1.5.0-beta"),
        EpicSpec("Analytics & Customer Insights", "Event telemetry, dashboard metrics, and reporting", "v2.0.0-GA"),
        EpicSpec("User Experience & Accessibility", "WCAG 2.1 compliance, responsive layouts, and animations", "v1.0.0-alpha"),
        EpicSpec("Release Readiness & Reliability", "Disaster recovery, automated testing, and SLA monitoring", "v2.0.0-GA"),
    ],
    sprints=[
        SprintSpec("Sprint 1 - Foundation", "Architecture setup and initial data models", -4, 2, "closed"),
        SprintSpec("Sprint 2 - Core Features", "Primary workflows and API endpoints", -2, 2, "closed"),
        SprintSpec("Sprint 3 - Performance & UX", "Caching, design polish, and accessibility", 0, 2, "active"),
        SprintSpec("Sprint 4 - Release Readiness", "End-to-end testing, documentation, and go-live prep", 2, 2, "future"),
    ],
    verbs={
        "Story": ["As a user I want to", "Enable", "Allow users to", "Support"],
        "Task": ["Refactor", "Configure", "Document", "Upgrade", "Clean up"],
        "Bug": ["Crashes when", "Fails to load", "Returns 500 on", "Freezes during"],
        "Feature": ["Introduce", "Roll out", "Build", "Launch"],
    },
    subjects=[
        "Login and session workflow", "Dashboard metric calculations",
        "Data export to CSV/PDF", "Notification preferences settings",
        "User profile and avatar upload", "Search and filtering engine",
        "API rate limiting middleware", "Automated email welcome sequence",
    ],
    labels=["core", "ux", "backend", "frontend", "api", "perf"],
    bug_topics=[
        "Dashboard query times out on large datasets",
        "Session expires unexpectedly during editing",
        "Search filter returns empty state incorrectly",
    ],
)


PROFILES_REGISTRY: Dict[str, DomainProfile] = {
    "ecommerce": ECOMMERCE_PROFILE,
    "checkout": ECOMMERCE_PROFILE,
    "platform": PLATFORM_PROFILE,
    "infra": PLATFORM_PROFILE,
    "infrastructure": PLATFORM_PROFILE,
    "mobile": MOBILE_PROFILE,
    "app": MOBILE_PROFILE,
    "ai": AI_PLATFORM_PROFILE,
    "ai-platform": AI_PLATFORM_PROFILE,
    "ml": AI_PLATFORM_PROFILE,
    "fintech": FINTECH_PROFILE,
    "security": FINTECH_PROFILE,
    "general": GENERAL_PROFILE,
}


def get_profile(name_or_key: str | None) -> DomainProfile:
    """
    Resolve a domain profile by name (e.g. 'ecommerce', 'mobile') or auto-detect
    from a Jira project key (e.g. 'CHK' -> ecommerce, 'CORE' -> platform, 'AIP' -> ai-platform).
    """
    if not name_or_key:
        return ECOMMERCE_PROFILE

    cleaned = name_or_key.strip().lower()

    # Exact profile match
    if cleaned in PROFILES_REGISTRY:
        return PROFILES_REGISTRY[cleaned]

    # Project key heuristics
    if any(k in cleaned for k in ["chk", "pay", "shop", "cart", "comm", "order"]):
        return ECOMMERCE_PROFILE
    if any(k in cleaned for k in ["core", "inf", "ops", "plat", "db", "cloud"]):
        return PLATFORM_PROFILE
    if any(k in cleaned for k in ["mob", "app", "ios", "and", "ui", "client"]):
        return MOBILE_PROFILE
    if any(k in cleaned for k in ["ai", "aip", "ml", "rag", "bot", "llm", "gen"]):
        return AI_PLATFORM_PROFILE
    if any(k in cleaned for k in ["fin", "sec", "gov", "bank", "risk", "audit"]):
        return FINTECH_PROFILE

    return GENERAL_PROFILE
