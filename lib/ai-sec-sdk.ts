/**
 * AI Security SDK for Runtime Telemetry
 * Auto-bundled by Agents360
 */

// SDK Version - used to check if SDK needs updating
export const SDK_VERSION = "1.0.0";

export interface AgentSecurityConfig {
  projectId?: string;
  ingestionUrl?: string;
  agentKey?: string;
  agentId?: string;
  fetchPoliciesIntervalMs?: number;
}

export interface LlmCallContext {
  provider: string;
  model?: string;
  region?: string;
  route?: string;
  tenantId?: string;
  prompt: string;
  response?: string;
}

export interface HttpCallContext {
  host: string;
  path?: string;
  ipAddress?: string;
  route?: string;
  tenantId?: string;
  payloadSample?: string;
}

export interface LogEventContext {
  level: "debug" | "info" | "warn" | "error";
  message: string;
  route?: string;
  tenantId?: string;
}

export interface PolicyViolationContext {
  violationType: string;
  severity: "low" | "medium" | "high" | "critical";
  route?: string;
  tenantId?: string;
  details?: Record<string, unknown>;
}

interface PiiFlags {
  email: boolean;
  phone: boolean;
  generic_id: boolean;
  credit_card?: boolean;
  ssn?: boolean;
  address?: boolean;
}

interface SecretFlags {
  api_key_pattern: boolean;
  bearer_token?: boolean;
  password_pattern?: boolean;
}

interface TelemetryPayload {
  catalog_agent_id?: string;
  event_type: string;
  provider?: string;
  model?: string;
  region?: string;
  host?: string;
  path?: string;
  ip_address?: string;
  route?: string;
  tenant_id?: string;
  prompt_length?: number;
  response_length?: number;
  pii_flags?: PiiFlags | Record<string, boolean>;
  secret_flags?: SecretFlags | Record<string, boolean>;
  policy_flags?: Record<string, boolean>;
  metadata?: Record<string, unknown>;
}

let currentConfig: AgentSecurityConfig | null = null;
let policyFetchInterval: ReturnType<typeof setInterval> | null = null;

function classifyTextForPii(text: string): PiiFlags {
  if (!text) return { email: false, phone: false, generic_id: false };
  return {
    email: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i.test(text),
    phone: /\+?\d[\d\s\-()]{7,}/.test(text),
    generic_id: /\b\d{8,}\b/.test(text),
    credit_card: /\b(?:\d{4}[-\s]?){3}\d{4}\b/.test(text),
    ssn: /\b\d{3}[-\s]?\d{2}[-\s]?\d{4}\b/.test(text),
    address: /\b\d+\s+[\w\s]+(?:street|st|avenue|ave|road|rd|drive|dr|lane|ln|way|court|ct|boulevard|blvd)\b/i.test(text),
  };
}

function classifyTextForSecrets(text: string): SecretFlags {
  if (!text) return { api_key_pattern: false };
  return {
    api_key_pattern: /(sk-[A-Za-z0-9]{20,}|api[_-]?key\s*[:=]\s*['"]?[A-Za-z0-9]{16,})/i.test(text),
    bearer_token: /bearer\s+[A-Za-z0-9\-._~+\/]+=*/i.test(text),
    password_pattern: /(password|passwd|pwd)\s*[:=]\s*['"][^'"]{4,}/i.test(text),
  };
}

function getConfigOrThrow(): AgentSecurityConfig {
  if (!currentConfig) throw new Error("[ai-sec-sdk] SDK not initialized. Call initAgentSecurity() first.");
  if (!currentConfig.ingestionUrl) throw new Error("[ai-sec-sdk] Missing ingestionUrl.");
  if (!currentConfig.agentKey) throw new Error("[ai-sec-sdk] Missing agentKey.");
  return currentConfig;
}

function startPolicyFetchLoop(intervalMs: number): void {
  if (policyFetchInterval) clearInterval(policyFetchInterval);
  policyFetchInterval = setInterval(async () => {
    try {
      console.debug("[ai-sec-sdk] Policy fetch placeholder");
    } catch (err) {
      console.error("[ai-sec-sdk] Failed to fetch policies", err);
    }
  }, intervalMs);
}

async function sendTelemetry(eventPayload: TelemetryPayload): Promise<void> {
  const cfg = getConfigOrThrow();
  if (cfg.agentId && !eventPayload.catalog_agent_id) eventPayload.catalog_agent_id = cfg.agentId;
  try {
    const response = await fetch(cfg.ingestionUrl!, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Agent-Key": cfg.agentKey || "",
        "X-Project-Id": cfg.projectId || "",
      },
      body: JSON.stringify(eventPayload),
    });
    if (!response.ok) console.error("[ai-sec-sdk] Telemetry request failed:", response.status);
  } catch (err) {
    console.error("[ai-sec-sdk] Failed to send telemetry", err);
  }
}

export function initAgentSecurity(config?: AgentSecurityConfig): void {
  const envConfig: AgentSecurityConfig = {
    projectId: typeof process !== 'undefined' ? process.env?.AI_SEC_PROJECT_ID : undefined,
    ingestionUrl: typeof process !== 'undefined' ? process.env?.AI_SEC_INGEST_URL : undefined,
    agentKey: typeof process !== 'undefined' ? process.env?.AI_SEC_AGENT_KEY : undefined,
    agentId: typeof process !== 'undefined' ? process.env?.AI_SEC_AGENT_ID : undefined,
    fetchPoliciesIntervalMs: 60000,
  };
  currentConfig = { ...envConfig, ...config };
  console.log("[ai-sec-sdk] Initialized");
  if (currentConfig.fetchPoliciesIntervalMs && currentConfig.fetchPoliciesIntervalMs > 0) {
    startPolicyFetchLoop(currentConfig.fetchPoliciesIntervalMs);
  }
}

export async function recordLlmCall(ctx: LlmCallContext): Promise<void> {
  await sendTelemetry({
    event_type: "llm_call",
    provider: ctx.provider,
    model: ctx.model,
    region: ctx.region,
    route: ctx.route,
    tenant_id: ctx.tenantId,
    prompt_length: ctx.prompt.length,
    response_length: ctx.response?.length,
    pii_flags: classifyTextForPii(ctx.prompt),
    secret_flags: classifyTextForSecrets(ctx.prompt),
  });
}

export async function recordHttpCall(ctx: HttpCallContext): Promise<void> {
  await sendTelemetry({
    event_type: "http_call",
    host: ctx.host,
    path: ctx.path,
    ip_address: ctx.ipAddress,
    route: ctx.route,
    tenant_id: ctx.tenantId,
    pii_flags: ctx.payloadSample ? classifyTextForPii(ctx.payloadSample) : {},
    secret_flags: ctx.payloadSample ? classifyTextForSecrets(ctx.payloadSample) : {},
  });
}

export async function recordLogEvent(ctx: LogEventContext): Promise<void> {
  await sendTelemetry({
    event_type: "log_event",
    route: ctx.route,
    tenant_id: ctx.tenantId,
    metadata: {
      level: ctx.level,
      pii_flags: classifyTextForPii(ctx.message),
      secret_flags: classifyTextForSecrets(ctx.message),
    },
  });
}

export async function recordPolicyViolation(ctx: PolicyViolationContext): Promise<void> {
  await sendTelemetry({
    event_type: "policy_violation",
    route: ctx.route,
    tenant_id: ctx.tenantId,
    policy_flags: { [ctx.violationType]: true },
    metadata: { severity: ctx.severity, details: ctx.details },
  });
}

export function shutdownAgentSecurity(): void {
  if (policyFetchInterval) { clearInterval(policyFetchInterval); policyFetchInterval = null; }
  currentConfig = null;
  console.log("[ai-sec-sdk] Shutdown complete");
}

export { classifyTextForPii, classifyTextForSecrets };
