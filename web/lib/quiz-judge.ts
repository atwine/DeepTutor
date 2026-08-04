import { wsUrl } from "@/lib/api";

/** An image attached to a quiz answer for AI judging. */
export interface QuizJudgeImage {
  /** Base64 of the freshly-picked image (no ``data:`` prefix). */
  base64: string | null;
  /** AttachmentStore URL for a previously persisted image. */
  url: string | null;
  filename: string;
  mime_type: string;
}

/** Request payload sent to the quiz judge WebSocket. */
export interface QuizJudgeRequest {
  question: string;
  question_type: string;
  options: Record<string, string> | null;
  correct_answer: string;
  explanation: string;
  user_answer: string;
  /** Multi-image list — backend builds a multimodal user message from this. */
  user_answer_images: QuizJudgeImage[];
  language: "zh" | "en";
}

/** Handle for controlling an in-flight quiz judge WebSocket. */
export interface QuizJudgeHandle {
  close: () => void;
}

/** Callbacks for streaming quiz judge events. */
export interface QuizJudgeHandlers {
  onStart?: () => void;
  onChunk: (chunk: string) => void;
  onDone: (finalText: string) => void;
  onError: (message: string) => void;
}

/** Open a WebSocket to the quiz judge and stream the AI's verdict.
 * @param payload - Question, answer, and image data for judging.
 * @param handlers - Streaming callbacks (start, chunk, done, error).
 * @returns A handle to close the connection early. */
export function startQuizJudge(
  payload: QuizJudgeRequest,
  handlers: QuizJudgeHandlers,
): QuizJudgeHandle {
  const ws = new WebSocket(wsUrl("/api/v1/question/judge"));
  let buffer = "";
  let finished = false;

  const finalize = (kind: "done" | "error", message?: string) => {
    if (finished) return;
    finished = true;
    if (kind === "done") {
      handlers.onDone(buffer);
    } else {
      handlers.onError(message ?? "AI judge failed.");
    }
    try {
      ws.close();
    } catch {
      /* ignore */
    }
  };

  ws.onopen = () => {
    try {
      ws.send(JSON.stringify(payload));
    } catch (err) {
      finalize("error", err instanceof Error ? err.message : String(err));
    }
  };

  ws.onmessage = (ev) => {
    let frame: { type?: string; content?: string };
    try {
      frame = JSON.parse(ev.data);
    } catch {
      return;
    }
    if (frame.type === "started") {
      handlers.onStart?.();
      return;
    }
    if (frame.type === "text" && typeof frame.content === "string") {
      buffer += frame.content;
      handlers.onChunk(frame.content);
      return;
    }
    if (frame.type === "done") {
      finalize("done");
      return;
    }
    if (frame.type === "error") {
      finalize("error", frame.content || "AI judge failed.");
    }
  };

  ws.onerror = () => {
    finalize("error", "AI judge connection error.");
  };

  ws.onclose = () => {
    if (!finished) {
      finalize("error", "AI judge connection closed unexpectedly.");
    }
  };

  return {
    close: () => {
      if (!finished) {
        finished = true;
      }
      try {
        ws.close();
      } catch {
        /* ignore */
      }
    },
  };
}

/** Read a File as base64 (no data-URI prefix) with its MIME type and name.
 * @param file - The image file to read.
 * @returns Object with base64 string, MIME type, and filename. */
export function readFileAsBase64(
  file: File,
): Promise<{ base64: string; mime: string; name: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== "string") {
        reject(new Error("Failed to read file"));
        return;
      }
      const comma = result.indexOf(",");
      const base64 = comma >= 0 ? result.slice(comma + 1) : result;
      resolve({
        base64,
        mime: file.type || "image/png",
        name: file.name || "answer.png",
      });
    };
    reader.onerror = () =>
      reject(reader.error ?? new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
}
