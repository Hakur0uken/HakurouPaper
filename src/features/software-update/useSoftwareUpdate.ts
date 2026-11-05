import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { platform } from "../../platform";
import { SoftwareUpdateController } from "./controller";

export function useSoftwareUpdate(startupReady: boolean, installationBlock: () => "unsaved" | "busy" | null) {
  const blockRef = useRef(installationBlock);
  blockRef.current = installationBlock;
  const [controller] = useState(() => new SoftwareUpdateController(platform.updates, () => blockRef.current()));
  const state = useSyncExternalStore(controller.subscribe, controller.snapshot, controller.snapshot);
  const started = useRef(false);
  useEffect(() => {
    if (!startupReady || started.current || !isTauri()) return;
    const timer = window.setTimeout(() => { started.current = true; void controller.check(false); }, 1_500);
    return () => window.clearTimeout(timer);
  }, [controller, startupReady]);
  // This controller lives for the single desktop window's lifetime. Later keeps
  // its downloaded update ready; the OS releases resources when the app exits.
  return { controller, state };
}
