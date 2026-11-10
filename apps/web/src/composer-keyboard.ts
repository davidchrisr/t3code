import { redo, undo } from "@tiptap/pm/history";
import { TextSelection, type EditorState } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import type { KeyboardShortcutAction } from "./components/KeyboardShortcutBar";

export type ComposerKeyboardAction = KeyboardShortcutAction | "undo" | "redo";

export function composerKeyboardSelectionTransaction(
  state: EditorState,
  anchor: number,
  head: number,
) {
  const selection = TextSelection.create(state.doc, anchor, head);
  if (selection.eq(state.selection)) return null;
  return state.tr.setSelection(selection).scrollIntoView();
}

export function runComposerKeyboardAction(view: EditorView, action: ComposerKeyboardAction): void {
  if (!view.editable || view.composing) return;
  view.focus();

  if (action === "undo" || action === "redo") {
    const command = action === "undo" ? undo : redo;
    command(view.state, (tr) => view.dispatch(tr.scrollIntoView()));
    return;
  }
  if (action === "tab") {
    const event = new KeyboardEvent("keydown", {
      key: "Tab",
      code: "Tab",
      bubbles: true,
      cancelable: true,
    });
    view.dom.dispatchEvent(event);
    if (!event.defaultPrevented) view.dispatch(view.state.tr.insertText("\t").scrollIntoView());
    return;
  }
  if (action === "$" || action === "/" || action === "`") {
    const { from, to } = view.state.selection;
    const insert = () => view.state.tr.insertText(action, from, to);
    if (!view.someProp("handleTextInput", (handler) => handler(view, from, to, action, insert))) {
      view.dispatch(insert().scrollIntoView());
    }
    return;
  }

  const event = new KeyboardEvent("keydown", {
    key: action === "left" ? "ArrowLeft" : "ArrowRight",
  });
  if (view.someProp("handleKeyDown", (handler) => handler(view, event))) return;

  const selection = view.dom.ownerDocument.getSelection();
  if (!selection) return;
  selection.modify("move", action, "character");
  if (
    selection.anchorNode &&
    selection.focusNode &&
    view.dom.contains(selection.anchorNode) &&
    view.dom.contains(selection.focusNode)
  ) {
    const transaction = composerKeyboardSelectionTransaction(
      view.state,
      view.posAtDOM(selection.anchorNode, selection.anchorOffset),
      view.posAtDOM(selection.focusNode, selection.focusOffset),
    );
    if (transaction) view.dispatch(transaction);
  }
}
