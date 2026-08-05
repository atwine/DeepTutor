// Type definitions mirroring deeptutor.book.models on the backend.
// Kept loose (Record<string, unknown>) where the payload is block-type
// specific so we don't have to keep these in lock-step.

/** Lifecycle status of a book. */
export type BookStatus =
  | "draft"
  | "spine_ready"
  | "compiling"
  | "ready"
  | "error"
  | "archived";

/** Lifecycle status of a page within a book. */
export type PageStatus =
  | "pending"
  | "planning"
  | "generating"
  | "ready"
  | "partial"
  | "error";

/** Lifecycle status of a block within a page. */
export type BlockStatus =
  | "pending"
  | "generating"
  | "ready"
  | "error"
  | "hidden";

/** Supported block types rendered on a book page. */
export type BlockType =
  | "text"
  | "callout"
  | "quiz"
  | "user_note"
  | "figure"
  | "interactive"
  | "animation"
  | "code"
  | "timeline"
  | "flash_cards"
  | "deep_dive"
  | "section"
  | "concept_graph";

/** Content type classification for pages and chapters. */
export type ContentType =
  | "theory"
  | "derivation"
  | "history"
  | "practice"
  | "concept"
  | "overview";

/** A node in a book's concept graph. */
export interface ConceptNode {
  id: string;
  label: string;
  chapter_id: string;
  description: string;
  weight: number;
}

/** A directed edge in a book's concept graph. */
export interface ConceptEdge {
  src: string;
  dst: string;
  relation: "depends_on" | "extends" | "related" | string;
  rationale: string;
}

/** A concept graph containing nodes and edges. */
export interface ConceptGraph {
  nodes: ConceptNode[];
  edges: ConceptEdge[];
}

/** A source anchor referencing the origin of a block's content. */
export interface SourceAnchor {
  kind: string;
  ref: string;
  snippet: string;
}

/** A content block within a book page. */
export interface Block {
  id: string;
  type: BlockType;
  status: BlockStatus;
  title: string;
  params: Record<string, unknown>;
  payload: Record<string, unknown>;
  source_anchors: SourceAnchor[];
  metadata: Record<string, unknown>;
  error: string;
  created_at: number;
  updated_at: number;
}

/** A page within a book, containing ordered blocks. */
export interface Page {
  id: string;
  book_id: string;
  chapter_id: string;
  title: string;
  learning_objectives: string[];
  content_type: ContentType;
  status: PageStatus;
  order: number;
  blocks: Block[];
  links: Array<{ target_page_id: string; relation: string; label: string }>;
  parent_page_id: string;
  error: string;
  created_at: number;
  updated_at: number;
}

/** A chapter in a book's spine, grouping pages. */
export interface Chapter {
  id: string;
  title: string;
  learning_objectives: string[];
  content_type: ContentType;
  source_anchors: SourceAnchor[];
  prerequisites: string[];
  page_ids: string[];
  summary: string;
  order: number;
}

/** The structural spine of a book — chapters, concept graph, and metadata. */
export interface Spine {
  book_id: string;
  chapters: Chapter[];
  version: number;
  updated_at: number;
  concept_graph?: ConceptGraph;
  exploration_summary?: string;
}

/** AI-generated proposal for a new book's scope and structure. */
export interface BookProposal {
  title: string;
  description: string;
  scope: string;
  target_level: string;
  estimated_chapters: number;
  rationale: string;
}

/** A book record with its metadata and status. */
export interface Book {
  id: string;
  title: string;
  description: string;
  status: BookStatus;
  proposal: BookProposal | null;
  knowledge_bases: string[];
  language: string;
  page_count: number;
  chapter_count: number;
  created_at: number;
  updated_at: number;
  metadata: Record<string, unknown> & {
    page_chat_sessions?: Record<string, string>;
  };
}

/** A reader's progress through a book. */
export interface Progress {
  book_id: string;
  current_page_id: string;
  visited_page_ids: string[];
  bookmarked_page_ids: string[];
  quiz_attempts: Array<{
    block_id: string;
    page_id: string;
    question_id: string;
    user_answer: string;
    is_correct: boolean;
    timestamp: number;
  }>;
  weak_chapters: string[];
  score: number;
  updated_at: number;
}

/** Full book detail — book metadata, spine, pages, and reader progress. */
export interface BookDetail {
  book: Book;
  spine: Spine | null;
  pages: Page[];
  progress: Progress;
}
