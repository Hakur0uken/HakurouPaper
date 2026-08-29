import type { RevisionTextSnapshot } from "../../platform";
import { buildRenderedRevisionModel, buildRevisionLocations } from "./renderedRevisionModel";

type Request = { type: "compute"; requestId: number; before: RevisionTextSnapshot; after: RevisionTextSnapshot };

self.addEventListener("message", (event: MessageEvent<Request>) => {
  const request = event.data;
  if (request.type !== "compute") return;
  try {
    const model = buildRenderedRevisionModel(request.before, request.after);
    self.postMessage({ type: "result", requestId: request.requestId, model, locations: buildRevisionLocations(model) });
  } catch (error) {
    self.postMessage({ type: "error", requestId: request.requestId, message: String(error) });
  }
});
