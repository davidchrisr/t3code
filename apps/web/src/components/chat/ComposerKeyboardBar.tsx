import {
  ChevronLeftIcon,
  ChevronRightIcon,
  KeyboardOffIcon,
  Redo2Icon,
  Undo2Icon,
} from "lucide-react";

import type { ComposerKeyboardAction } from "~/composer-keyboard";
import { Button } from "../ui/button";

export function isComposerKeyboardFocusTarget(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    (target.matches('[data-testid="composer-editor"]') ||
      target.closest("[data-composer-keyboard-bar]") !== null)
  );
}

export function ComposerKeyboardBar({
  disabled,
  onAction,
  onHideKeyboard,
}: {
  disabled: boolean;
  onAction: (action: ComposerKeyboardAction) => void;
  onHideKeyboard: () => void;
}) {
  return (
    <div
      role="group"
      aria-label="Composer keyboard shortcuts"
      data-composer-keyboard-bar="true"
      className="relative flex w-full min-w-0 items-center justify-between overflow-x-auto rounded-b-2xl border-t border-(--chat-composer-outline) px-1 py-1 select-none touch-pan-x [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      // iOS still blurs on cancelled pointerdown; use mousedown (WebKit #322721).
      onMouseDown={(event) => event.preventDefault()}
    >
      <Button
        variant="ghost-muted-press"
        size="icon-xl"
        aria-label="Insert $ for skills"
        disabled={disabled}
        onClick={() => onAction("$")}
      >
        <span aria-hidden="true" className="font-mono">
          $
        </span>
      </Button>
      <Button
        variant="ghost-muted-press"
        size="icon-xl"
        aria-label="Insert / for commands"
        disabled={disabled}
        onClick={() => onAction("/")}
      >
        <span aria-hidden="true" className="font-mono">
          /
        </span>
      </Button>
      <Button
        variant="ghost-muted-press"
        size="icon-xl"
        aria-label="Insert backtick"
        disabled={disabled}
        onClick={() => onAction("`")}
      >
        <span aria-hidden="true" className="font-mono">
          `
        </span>
      </Button>
      <Button
        variant="ghost-muted-press"
        size="icon-xl"
        aria-label="Move cursor left"
        disabled={disabled}
        onClick={() => onAction("left")}
      >
        <ChevronLeftIcon />
      </Button>
      <Button
        variant="ghost-muted-press"
        size="icon-xl"
        aria-label="Move cursor right"
        disabled={disabled}
        onClick={() => onAction("right")}
      >
        <ChevronRightIcon />
      </Button>
      <Button
        variant="ghost-muted-press"
        size="icon-xl"
        aria-label="Undo"
        disabled={disabled}
        onClick={() => onAction("undo")}
      >
        <Undo2Icon />
      </Button>
      <Button
        variant="ghost-muted-press"
        size="icon-xl"
        aria-label="Redo"
        disabled={disabled}
        onClick={() => onAction("redo")}
      >
        <Redo2Icon />
      </Button>
      <Button
        variant="ghost-muted-press"
        size="icon-xl"
        aria-label="Hide keyboard"
        onClick={onHideKeyboard}
      >
        <KeyboardOffIcon />
      </Button>
    </div>
  );
}
