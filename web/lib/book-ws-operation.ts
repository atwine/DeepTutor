/** Generic event shape exchanged over the book WebSocket. */
export type BookWsEvent = { type: string; [key: string]: unknown };

/** Minimal socket interface used by {@link runBookSocketOperation}. */
export interface BookSocketLike {
  onopen: ((event: Event) => void) | null;
  onmessage: ((event: MessageEvent<string>) => void) | null;
  onerror: ((event: Event) => void) | null;
  onclose: ((event: CloseEvent) => void) | null;
  send(data: string): void;
  close(): void;
}

/** Options for running a single book WebSocket operation. */
export interface BookSocketOperationOptions {
  message: BookWsEvent;
  resultType: string;
  onEvent?: (event: BookWsEvent) => void;
}

function errorMessage(event: BookWsEvent): string {
  const detail = event.content ?? event.message ?? event.detail;
  return typeof detail === "string" && detail.trim()
    ? detail
    : "Book WebSocket operation failed";
}

/**
 * Run a single request/response cycle over a book WebSocket.
 *
 * Opens a socket, sends the message, and resolves when the matching
 * result event arrives (or rejects on error/close).
 *
 * @param createSocket - Factory that returns a fresh socket instance.
 * @param options - Message, expected result type, and optional event callback.
 * @returns The result event payload.
 */
export function runBookSocketOperation<T extends BookWsEvent = BookWsEvent>(
  createSocket: () => BookSocketLike,
  options: BookSocketOperationOptions,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const socket = createSocket();
    let settled = false;

    const finish = (callback: () => void, closeSocket: boolean): void => {
      if (settled) return;
      settled = true;
      if (closeSocket) {
        try {
          socket.close();
        } catch {
          // The operation result is authoritative even if cleanup fails.
        }
      }
      callback();
    };

    socket.onopen = () => {
      try {
        socket.send(JSON.stringify(options.message));
      } catch (error) {
        finish(
          () =>
            reject(
              error instanceof Error
                ? error
                : new Error("Failed to send Book WebSocket operation"),
            ),
          true,
        );
      }
    };

    socket.onmessage = (message) => {
      let event: BookWsEvent;
      try {
        event = JSON.parse(message.data) as BookWsEvent;
      } catch {
        return;
      }

      options.onEvent?.(event);

      if (event.type === "error") {
        finish(() => reject(new Error(errorMessage(event))), true);
        return;
      }

      if (event.type === options.resultType) {
        finish(() => resolve(event as T), true);
      }
    };

    socket.onerror = () => {
      finish(() => reject(new Error("Book WebSocket connection failed")), true);
    };

    socket.onclose = () => {
      finish(
        () =>
          reject(
            new Error(
              `Book WebSocket closed before ${options.resultType} was received`,
            ),
          ),
        false,
      );
    };
  });
}
