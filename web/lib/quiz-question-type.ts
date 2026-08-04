/** Canonical quiz question type after normalization. */
export type NormalizedQuizQuestionType =
  | "choice"
  | "concept"
  | "fill_in_blank"
  | "short_answer"
  | "written"
  | "coding";

/** All supported normalized quiz question types. */
export const QUIZ_QUESTION_TYPES: ReadonlyArray<NormalizedQuizQuestionType> = [
  "choice",
  "concept",
  "fill_in_blank",
  "short_answer",
  "written",
  "coding",
];

const QUESTION_TYPE_ALIASES: Record<string, NormalizedQuizQuestionType> = {
  choice: "choice",
  multiple_choice: "choice",
  "multiple-choice": "choice",
  mcq: "choice",
  concept: "concept",
  true_false: "concept",
  "true-false": "concept",
  tf: "concept",
  judgement: "concept",
  fill_in_blank: "fill_in_blank",
  "fill-in-the-blank": "fill_in_blank",
  fill_in_the_blank: "fill_in_blank",
  cloze: "fill_in_blank",
  short_answer: "short_answer",
  "short-answer": "short_answer",
  written: "written",
  open_ended: "written",
  "open-ended": "written",
  open_response: "written",
  "open-response": "written",
  essay: "written",
  coding: "coding",
  code: "coding",
  programming: "coding",
};

/** Normalize a raw question-type string into a canonical type.
 * @param value - The raw type string (case-insensitive, various aliases).
 * @returns The normalized type (defaults to "short_answer"). */
export function normalizeQuizQuestionType(
  value: unknown,
): NormalizedQuizQuestionType {
  const normalized = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_");
  return QUESTION_TYPE_ALIASES[normalized] || "short_answer";
}

/** Check whether a question type normalizes to "choice".
 * @param value - The raw type string.
 * @returns True if the type is a multiple-choice variant. */
export function isChoiceQuizQuestion(value: unknown): boolean {
  return normalizeQuizQuestionType(value) === "choice";
}

/** Check whether a question type normalizes to "concept" (true/false).
 * @param value - The raw type string.
 * @returns True if the type is a concept/true-false variant. */
export function isConceptQuizQuestion(value: unknown): boolean {
  return normalizeQuizQuestionType(value) === "concept";
}

/** Check whether a question type normalizes to "fill_in_blank".
 * @param value - The raw type string.
 * @returns True if the type is a fill-in-the-blank variant. */
export function isFillInBlankQuizQuestion(value: unknown): boolean {
  return normalizeQuizQuestionType(value) === "fill_in_blank";
}

/** Check whether a question type is free-text (short answer, essay, or coding).
 * @param value - The raw type string.
 * @returns True if the type accepts free-text answers. */
export function isFreeTextQuizQuestion(value: unknown): boolean {
  const t = normalizeQuizQuestionType(value);
  return t === "short_answer" || t === "written" || t === "coding";
}

/** Resolve the option key (A, B, …) for a choice question's correct answer.
 * @param correctAnswer - The correct answer (key or label text).
 * @param options - The question's option map.
 * @returns The uppercase option key, or empty string if unresolvable. */
export function resolveChoiceAnswerKey(
  correctAnswer: unknown,
  options: Record<string, string> | null | undefined,
): string {
  const correct = String(correctAnswer || "").trim();
  if (!correct || !options) return "";

  const directKey = correct.toUpperCase();
  if (directKey in options) {
    return directKey;
  }

  const normalizedAnswer = correct.toLowerCase();
  for (const [key, label] of Object.entries(options)) {
    if (
      normalizedAnswer ===
      String(label || "")
        .trim()
        .toLowerCase()
    ) {
      return key.toUpperCase();
    }
  }

  return directKey;
}

/**
 * Canonical T/F answer for ``concept`` questions. The backend pipeline
 * normalizes the model's output into the lowercase strings ``"true"`` /
 * ``"false"``; callers should compare against this exactly.
 */
export function resolveConceptAnswer(
  correctAnswer: unknown,
): "true" | "false" | "" {
  const normalized = String(correctAnswer || "")
    .trim()
    .toLowerCase();
  if (normalized === "true") return "true";
  if (normalized === "false") return "false";
  return "";
}
