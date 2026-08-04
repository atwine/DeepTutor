/** Minimal keyboard event shape needed for submit/IME detection. */
export interface KeyboardSubmitEventLike {
  key: string;
  shiftKey?: boolean;
  isComposing?: boolean;
  keyCode?: number;
  which?: number;
  nativeEvent?: {
    isComposing?: boolean;
    keyCode?: number;
    which?: number;
  };
}

const IME_PROCESS_KEY_CODE = 229;

/**
 * Detect whether a keyboard event is part of an IME composition sequence.
 *
 * @param event - The keyboard event to inspect.
 * @param compositionActive - Whether an IME composition is currently in progress.
 * @returns True if the event is part of an IME composition.
 */
export function isImeComposing(
  event: KeyboardSubmitEventLike,
  compositionActive = false,
): boolean {
  const nativeEvent = event.nativeEvent;
  return Boolean(
    compositionActive ||
    event.isComposing ||
    nativeEvent?.isComposing ||
    event.keyCode === IME_PROCESS_KEY_CODE ||
    event.which === IME_PROCESS_KEY_CODE ||
    nativeEvent?.keyCode === IME_PROCESS_KEY_CODE ||
    nativeEvent?.which === IME_PROCESS_KEY_CODE,
  );
}

/**
 * Determine whether an Enter keypress should submit the composer.
 *
 * Returns true only for a bare Enter (no Shift) outside of an IME composition.
 *
 * @param event - The keyboard event to inspect.
 * @param compositionActive - Whether an IME composition is currently in progress.
 * @returns True if the event should trigger a submit.
 */
export function shouldSubmitOnEnter(
  event: KeyboardSubmitEventLike,
  compositionActive = false,
): boolean {
  return (
    event.key === "Enter" &&
    !event.shiftKey &&
    !isImeComposing(event, compositionActive)
  );
}
