import type { ComposerKeyboardAction } from "~/composer-keyboard";
import { KeyboardShortcutBar } from "../KeyboardShortcutBar";

export function isComposerKeyboardFocusTarget(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    (target.matches('[data-testid="composer-editor"]') ||
      target.closest('[data-keyboard-shortcut-bar="composer"]') !== null)
  );
}

export function ComposerKeyboardBar({
  disabled,
  onAction,
}: {
  disabled: boolean;
  onAction: (action: ComposerKeyboardAction) => void;
}) {
  return (
    <KeyboardShortcutBar
      context="composer"
      disabled={disabled}
      onAction={onAction}
      history={{ undo: () => onAction("undo"), redo: () => onAction("redo") }}
    />
  );
}
