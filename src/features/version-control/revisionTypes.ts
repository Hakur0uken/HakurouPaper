export type RevisionLocationKind = "added" | "modified" | "removed";

export type RevisionBlockAnchor = {
  blockKind: string;
  text: string;
  imageUrl?: string;
  /** Index among top-level Markdown blocks in the current revision. */
  blockIndex?: number;
};

/**
 * One shared, document-relative change location. It drives preview navigation,
 * overview rulers, and editor-only decorations without becoming document data.
 */
export type RevisionLocation = {
  id: string;
  /** DOM anchor shared by every visual representation of this location. */
  targetId: string;
  kind: RevisionLocationKind;
  blockId: string;
  anchorBefore?: RevisionBlockAnchor;
  anchorAfter?: RevisionBlockAnchor;
  /** The closest surviving target block for showing a removed-content marker. */
  editorAnchor?: RevisionBlockAnchor;
  headingPath: string[];
  /** 0–1 position among the revision's top-level blocks. */
  relativePosition: number;
};
