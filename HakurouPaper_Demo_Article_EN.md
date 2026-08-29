# HakurouPaper: A Local-First Writing Workspace for Human–AI Collaboration

## Abstract

As generative AI becomes increasingly involved in long-form writing, conventional document tools expose a new tension between direct editing and transparent revision tracking. HakurouPaper explores a more natural collaboration model: authors continue to edit text, equations, tables, and figures in a familiar visual interface, while the underlying manuscript remains clean, open Markdown that AI can directly understand and modify. Version history is managed locally with Git, but changes are presented in a document-oriented form through revision markers, rendered comparisons, and safe restoration. The final manuscript can still be delivered as a Word document, allowing AI-assisted writing, human review, and existing academic workflows to coexist in the same environment.

**Keywords:** human–AI collaborative writing; Markdown; version control; local-first; academic writing

## 1. Design Motivation

Software development already has a mature model for human–AI collaboration. AI can work directly with structured plain text, while developers use diffs, version history, and rollback mechanisms to inspect every change. Document writing still lacks an equally natural workflow. Requiring every author to work directly in raw Markdown or LaTeX is unrealistic, while simply adding a chat panel beside a conventional document editor does little to solve the problems of reviewing and tracing continuous changes in long manuscripts.

HakurouPaper therefore brings **a human-friendly editing experience** and **an AI-friendly document structure** into the same workspace. Authors do not need to deal with the details of Markdown or Git, while the manuscript itself remains open, portable, and straightforward for AI to read and modify.

## 2. Document and Collaboration Architecture

Let the manuscript state at time $t$ be denoted by $D_t$. In HakurouPaper, a manuscript can be represented as a combination of content, assets, formatting information, and version state:

$$
D_t = \{M_t,\ A_t,\ F_t,\ V_t\},
$$

where $M_t$ denotes the Markdown content, $A_t$ represents local assets such as figures, $F_t$ contains formatting information stored independently from the manuscript text, and $V_t$ represents the current version state. This separation keeps content, presentation, and history decoupled internally while still presenting them to the user as one coherent document.

> **Paste the HakurouPaper architecture diagram from the PowerPoint file here.**  
> For demonstration purposes, copy the complete diagram directly from the provided PPT into HakurouPaper to test both the PNG preview and preservation of the original EMF vector graphic.

**Figure 1. Human–AI collaborative writing architecture in HakurouPaper.**

As illustrated in Figure 1, the human author and AI operate on the same document core. The author reads, writes, and formats through the visual editor, while AI works with the structured manuscript to understand and revise its content. Both types of edits converge on the same document state and are recorded through a unified version layer.

## 3. Every Change Remains Traceable

Once AI begins rewriting paragraphs, reorganizing sections, or continuously refining a manuscript, the key question is no longer only whether it can generate useful text, but **whether the author can clearly see what changed**. HakurouPaper treats each meaningful manuscript state as a version point and represents the change between adjacent states as

$$
\Delta_t = \operatorname{Diff}(D_{t-1}, D_t).
$$

These changes are not limited to source-level diffs. Text edits remain visible as text, equations continue to render as equations, and figures and tables retain their original reading form. Authors can quickly locate revisions, inspect them in context, and safely restore an earlier state when necessary.

## 4. From Writing to Files

HakurouPaper is designed so that each participant interacts mainly with the layer they actually need.

| Layer | What the author sees | What AI / tools work with | Persistent form |
| --- | --- | --- | --- |
| Content | Visual manuscript | Structured text | Markdown |
| Figures | Direct paste, resize, and layout | Explicit asset references | Local asset files |
| Versions | Create version, preview changes, restore | Comparable historical states | Git |
| Delivery | Export and share | Independent delivery workflow | Word |

This separation gives each component a clear role: Markdown supports writing and AI collaboration, Git provides history and recoverability, and Word remains the practical delivery format. Authors do not need to change the document habits of an entire research group simply to work with AI, nor do they need to abandon an open writing format just because the final deliverable is a Word document.

## 5. Local, Open, and Lightweight

HakurouPaper follows a local-first design. Text and equations remain in standard Markdown, figures and other assets are stored alongside the manuscript, and version history is managed with standard Git. Even if another Markdown-compatible tool is used later, the manuscript can still be opened and edited normally.

HakurouPaper is built with Tauri and aims to combine a modern editing experience with a small installation footprint and modest hardware requirements. The goal is to remain a writing tool that can be opened at any time, rather than becoming another heavyweight working environment.

## 6. Conclusion

The goal of HakurouPaper is not simply to add more features to a Markdown editor. Its purpose is to let humans and AI work on the same manuscript in the form each handles best: **AI works with content that is clean, structured, and traceable, while people work with a document that is familiar, visual, and recoverable.**

On this foundation, drafting, AI-assisted revision, version review, and Word delivery can become parts of one continuous writing workflow.
