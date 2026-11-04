import type { RevisionDescriptor } from "../../platform";
import type { UiText } from "../../i18n";

/** Attribution comes only from the compared commit, never the current user's settings. */
export function revisionAuthorship(revision: RevisionDescriptor, text: UiText) {
  if (revision.kind === "empty") return null;
  if (revision.kind !== "version") return { label: text.versionAuthorPending, timestamp: null };
  const nickname = revision.authorName?.trim();
  return { label: nickname ? text.versionAuthorBy(nickname) : text.versionAuthorUnknown, timestamp: revision.timestamp ?? null };
}
