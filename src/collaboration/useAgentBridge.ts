import { useEffect, useRef } from "react";
import { platform } from "../platform";
import { answerAgentRequest, type AgentHost } from "./agentProtocol";

export function useAgentBridge(ready: boolean, host: AgentHost) {
  const current = useRef(host);
  current.current = host;
  useEffect(() => {
    if (!ready) return;
    let disposed = false, cleanup: (() => void) | undefined;
    void platform.agent.onRequest((envelope) => answerAgentRequest(current.current, envelope.request)).then((dispose) => {
      if (disposed) dispose(); else cleanup = dispose;
    }).catch((error) => console.error("Unable to start the local agent bridge", error));
    return () => { disposed = true; cleanup?.(); };
  }, [ready]);
}
