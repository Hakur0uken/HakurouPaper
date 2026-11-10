export type AgentRequest = { action: "docs" | "get" | "replace" | "apply" | "save"; document?: string; revision?: string; find?: string; with?: string; all?: boolean; edits?: { start: number; end: number; text: string }[] };
export type AgentEnvelope = { id: string; expiresAt: number; request: AgentRequest };
export interface AgentService {
  onRequest(handler: (envelope: AgentEnvelope) => Promise<unknown>): Promise<() => void>;
}
