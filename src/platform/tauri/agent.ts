import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { AgentService, AgentEnvelope } from "../agentTypes";

export const tauriAgent: AgentService = {
  async onRequest(handler) {
    let disposed = false;
    let queue = Promise.resolve();
    const drain = () => {
      queue = queue.then(async () => {
        if (disposed) return;
        const requests = await invoke<AgentEnvelope[]>("take_agent_requests");
        for (const envelope of requests) {
          let response: { result?: unknown; error?: string };
          try {
            if (Date.now() >= envelope.expiresAt) throw new Error("request expired before it could run");
            response = { result: await handler(envelope) };
          } catch (error) { response = { error: error instanceof Error ? error.message : String(error) }; }
          await invoke("answer_agent_request", { id: envelope.id, response }).catch((error) => console.warn("Agent request ended before its response", error));
        }
      }).catch((error) => console.error("Unable to receive local agent requests", error));
      return queue;
    };
    const unlisten = await listen("agent-requested", drain);
    await drain();
    return () => { disposed = true; unlisten(); };
  },
};
