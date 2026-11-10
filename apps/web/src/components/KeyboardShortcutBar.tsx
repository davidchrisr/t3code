import {
  ArrowRightToLineIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  Redo2Icon,
  Undo2Icon,
} from "lucide-react";

import { Button } from "./ui/button";

export type KeyboardShortcutAction = "tab" | "$" | "/" | "`" | "left" | "right";

export function KeyboardShortcutBar({
  context,
  disabled,
  onAction,
  history,
}: {
  context: "composer" | "terminal";
  disabled: boolean;
  onAction: (action: KeyboardShortcutAction) => void;
  history?: { undo: () => void; redo: () => void };
}) {
  return (
    <div
      role="group"
      aria-label={
        context === "composer" ? "Composer keyboard shortcuts" : "Terminal keyboard shortcuts"
      }
      data-keyboard-shortcut-bar={context}
      className="relative flex w-full min-w-0 shrink-0 items-center justify-between overflow-x-auto border-t border-(--chat-composer-outline) px-1 py-1 select-none touch-pan-x data-[keyboard-shortcut-bar=composer]:rounded-b-2xl [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      // iOS still blurs on cancelled pointerdown; use mousedown (WebKit #322721).
      onMouseDown={(event) => event.preventDefault()}
    >
      <Button
        variant="ghost-muted-press"
        size="icon-xl"
        aria-label="Tab"
        disabled={disabled}
        onClick={() => onAction("tab")}
      >
        <ArrowRightToLineIcon />
      </Button>
      <Button
        variant="ghost-muted-press"
        size="icon-xl"
        aria-label={context === "composer" ? "Insert $ for skills" : "Insert $"}
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
        aria-label={context === "composer" ? "Insert / for commands" : "Insert /"}
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
      {history && (
        <>
          <Button
            variant="ghost-muted-press"
            size="icon-xl"
            aria-label="Undo"
            disabled={disabled}
            onClick={history.undo}
          >
            <Undo2Icon />
          </Button>
          <Button
            variant="ghost-muted-press"
            size="icon-xl"
            aria-label="Redo"
            disabled={disabled}
            onClick={history.redo}
          >
            <Redo2Icon />
          </Button>
        </>
      )}
    </div>
  );
}
