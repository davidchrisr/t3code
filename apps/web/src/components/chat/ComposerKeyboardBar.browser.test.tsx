import type { Editor } from "@tiptap/core";
import { createRef, useRef, useState, type RefObject } from "react";
import { expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

import { serializeEditorDoc } from "~/composer-rich-text-doc";
import { act, render } from "../../../test/render";
import {
  ComposerPromptEditorTiptap as ComposerPromptEditor,
  type ComposerPromptEditorHandle,
} from "../ComposerPromptEditorTiptap";
import { ComposerKeyboardBar } from "./ComposerKeyboardBar";

function Composer({
  initialValue,
  richTextEnabled = true,
  disabled = false,
  editorRef: suppliedRef,
}: {
  initialValue: string;
  richTextEnabled?: boolean;
  disabled?: boolean;
  editorRef?: RefObject<ComposerPromptEditorHandle | null>;
}) {
  const ownRef = useRef<ComposerPromptEditorHandle>(null);
  const editorRef = suppliedRef ?? ownRef;
  const [prompt, setPrompt] = useState({ value: initialValue, cursor: initialValue.length });
  return (
    <>
      <ComposerPromptEditor
        editorRef={editorRef}
        value={prompt.value}
        cursor={prompt.cursor}
        richTextEnabled={richTextEnabled}
        contextRecords={new Map()}
        skills={[]}
        disabled={disabled}
        placeholder="Message"
        onChange={(value, cursor) => setPrompt({ value, cursor })}
        onPaste={() => {}}
      />
      <ComposerKeyboardBar
        disabled={disabled}
        onAction={(action) => editorRef.current?.runKeyboardAction(action)}
        onHideKeyboard={() => {}}
      />
    </>
  );
}

function editorIn(container: HTMLElement): Editor {
  const element = container.querySelector<HTMLElement & { editor: Editor }>(".tiptap");
  if (!element) throw new Error("Composer did not mount");
  return element.editor;
}

it.each([
  { symbol: "$", label: "Insert $ for skills", richTextEnabled: true },
  { symbol: "/", label: "Insert / for commands", richTextEnabled: true },
  { symbol: "`", label: "Insert backtick", richTextEnabled: true },
  { symbol: "$", label: "Insert $ for skills", richTextEnabled: false },
  { symbol: "/", label: "Insert / for commands", richTextEnabled: false },
  { symbol: "`", label: "Insert backtick", richTextEnabled: false },
])(
  "inserts $symbol at the caret without moving focus, rich text $richTextEnabled",
  async ({ symbol, label, richTextEnabled }) => {
    await using screen = await render(
      <Composer initialValue="do this" richTextEnabled={richTextEnabled} />,
    );
    const editor = editorIn(screen.container);
    await act(() => {
      editor.commands.setTextSelection(4);
      editor.view.focus();
    });

    await userEvent.click(screen.getByRole("button", { name: label }));

    await vi.waitFor(() => {
      expect(serializeEditorDoc(editor.state.doc).value).toBe(`do ${symbol}this`);
      expect(editor.state.selection.head).toBe(5);
      expect(document.activeElement).toBe(editor.view.dom);
    });
  },
);

it("replaces the selected text and lets Undo restore it", async () => {
  await using screen = await render(<Composer initialValue="choose this" />);
  const editor = editorIn(screen.container);
  await act(() => {
    editor.commands.setTextSelection({ from: 1, to: 7 });
    editor.view.focus();
  });

  await userEvent.click(screen.getByRole("button", { name: "Insert $ for skills" }));
  await vi.waitFor(() => expect(serializeEditorDoc(editor.state.doc).value).toBe("$ this"));
  await userEvent.click(screen.getByRole("button", { name: "Undo", exact: true }));

  await vi.waitFor(() => {
    expect(serializeEditorDoc(editor.state.doc).value).toBe("choose this");
    expect(document.activeElement).toBe(editor.view.dom);
  });
});

it("uses the editor's backtick wrapping for a text selection", async () => {
  await using screen = await render(<Composer initialValue="code" />);
  const editor = editorIn(screen.container);
  await act(() => {
    editor.commands.setTextSelection({ from: 1, to: 5 });
    editor.view.focus();
  });

  await userEvent.click(screen.getByRole("button", { name: "Insert backtick" }));

  await vi.waitFor(() => expect(serializeEditorDoc(editor.state.doc).value).toBe("`code`"));
});

it("moves across an entire emoji in both directions", async () => {
  await using screen = await render(<Composer initialValue="a👩‍💻b" />);
  const editor = editorIn(screen.container);
  await act(() => {
    editor.commands.setTextSelection(editor.state.doc.content.size - 1);
    editor.view.focus();
  });

  await userEvent.click(screen.getByRole("button", { name: "Move cursor left" }));
  await userEvent.click(screen.getByRole("button", { name: "Move cursor left" }));
  await userEvent.click(screen.getByRole("button", { name: "Insert / for commands" }));
  await vi.waitFor(() => expect(serializeEditorDoc(editor.state.doc).value).toBe("a/👩‍💻b"));
  await userEvent.click(screen.getByRole("button", { name: "Move cursor right" }));
  await userEvent.click(screen.getByRole("button", { name: "Insert $ for skills" }));

  await vi.waitFor(() => {
    expect(serializeEditorDoc(editor.state.doc).value).toBe("a/👩‍💻$b");
    expect(document.activeElement).toBe(editor.view.dom);
  });
});

it.each([
  { direction: "left", expected: "/abc" },
  { direction: "right", expected: "abc/" },
])(
  "collapses a selection to its $direction edge before inserting",
  async ({ direction, expected }) => {
    await using screen = await render(<Composer initialValue="abc" />);
    const editor = editorIn(screen.container);
    await act(() => {
      editor.commands.setTextSelection({ from: 1, to: 4 });
      editor.view.focus();
    });

    await userEvent.click(screen.getByRole("button", { name: `Move cursor ${direction}` }));
    await userEvent.click(screen.getByRole("button", { name: "Insert / for commands" }));

    await vi.waitFor(() => expect(serializeEditorDoc(editor.state.doc).value).toBe(expected));
  },
);

it("does not mutate a read-only editor through its keyboard actions", async () => {
  const editorRef = createRef<ComposerPromptEditorHandle>();
  await using screen = await render(
    <Composer initialValue="draft" disabled editorRef={editorRef} />,
  );
  const editor = editorIn(screen.container);

  await act(() => editorRef.current?.runKeyboardAction("/"));

  expect(serializeEditorDoc(editor.state.doc).value).toBe("draft");
});
