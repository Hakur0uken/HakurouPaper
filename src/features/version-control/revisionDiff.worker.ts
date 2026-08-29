/// <reference lib="webworker" />

import { computeLightweightRevisionLocations, type LightweightRevisionDiffInput } from "./lightweightRevisionDiff";

type WorkerRequest = { type: "compute"; requestId: number; input: LightweightRevisionDiffInput };

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  if (event.data.type !== "compute") return;
  try {
    self.postMessage({ type: "result", requestId: event.data.requestId, locations: computeLightweightRevisionLocations(event.data.input) });
  } catch (error) {
    self.postMessage({ type: "error", requestId: event.data.requestId, message: String(error) });
  }
};

export {};
