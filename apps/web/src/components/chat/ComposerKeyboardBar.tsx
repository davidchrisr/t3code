import { ChevronLeftIcon, ChevronRightIcon, KeyboardOffIcon, Undo2Icon } from "lucide-react";

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
      className="relative z-10 mx-2 flex min-w-0 items-center justify-between gap-1 overflow-x-auto border-t border-border/60 py-1 select-none touch-pan-x [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      onPointerDown={(event) => event.preventDefault()}
    >
      <Button
        variant="ghost-muted"
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
        variant="ghost-muted"
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
        variant="ghost-muted"
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
        variant="ghost-muted"
        size="icon-xl"
        aria-label="Move cursor left"
        disabled={disabled}
        onClick={() => onAction("left")}
      >
        <ChevronLeftIcon />
      </Button>
      <Button
        variant="ghost-muted"
        size="icon-xl"
        aria-label="Move cursor right"
        disabled={disabled}
        onClick={() => onAction("right")}
      >
        <ChevronRightIcon />
      </Button>
      <Button
        variant="ghost-muted"
        size="icon-xl"
        aria-label="Undo"
        disabled={disabled}
        onClick={() => onAction("undo")}
      >
        <Undo2Icon />
      </Button>
      <Button
        variant="ghost-muted"
        size="icon-xl"
        aria-label="Hide keyboard"
        onClick={onHideKeyboard}
      >
        <KeyboardOffIcon />
      </Button>
    </div>
  );
}
