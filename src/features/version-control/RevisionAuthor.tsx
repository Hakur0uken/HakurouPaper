import type { UiText } from "../../i18n";
import type { RevisionDescriptor } from "../../platform";
import { revisionAuthorship } from "./revisionAuthorship";
import "./versionIdentity.css";

export function RevisionAuthor({ revision, text }: { revision: RevisionDescriptor; text: UiText }) {
  const author = revisionAuthorship(revision, text);
  if (!author) return null;
  const date = author.timestamp ? new Date(author.timestamp) : null;
  const time = date && !Number.isNaN(date.getTime()) ? date.toLocaleString() : null;
  return <span className={`revision-authorship${revision.kind === "version" ? "" : " is-unrecorded"}`}>
    <span>{author.label}</span>{time && <time dateTime={author.timestamp!}>{time}</time>}
  </span>;
}
