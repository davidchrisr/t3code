import { getSchema } from "@tiptap/core";
import { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { EditorState, TextSelection } from "@tiptap/pm/state";
import StarterKit from "@tiptap/starter-kit";
import { describe, expect, it } from "vite-plus/test";

import { composerKeyboardSelectionTransaction } from "./composer-keyboard";
import {
  buildDocJson,
  ComposerCodeExtension,
  serializeEditorDoc,
  stepCaretAcrossStyledEdge,
} from "./composer-rich-text-doc";

const schema = getSchema([StarterKit.configure({ code: false }), ComposerCodeExtension]);

function stateAt(value: string, anchor: number, head = anchor) {
  const doc = ProseMirrorNode.fromJSON(
    schema,
    buildDocJson(value, () => null),
  );
  return EditorState.create({ doc, selection: TextSelection.create(doc, anchor, head) });
}

function nativeSelection(state: EditorState, anchor: number, head = anchor) {
  const transaction = composerKeyboardSelectionTransaction(state, anchor, head);
  return transaction ? state.apply(transaction) : state;
}

function insertSlash(state: EditorState) {
  const { from, to } = state.selection;
  return serializeEditorDoc(state.apply(state.tr.insertText("/", from, to)).doc).value;
}

describe("composer keyboard selection", () => {
  it.each([
    { value: "**bold**", cursor: 1, direction: -1, expected: "/**bold**" },
    { value: "**bold**", cursor: 5, direction: 1, expected: "**bold**/" },
    { value: "`code`", cursor: 1, direction: -1, expected: "/`code`" },
    { value: "`code`", cursor: 5, direction: 1, expected: "`code`/" },
  ] as const)(
    "keeps insertion outside $value after an extra outward arrow at $cursor",
    ({ value, cursor, direction, expected }) => {
      const inside = stateAt(value, cursor);
      const step = stepCaretAcrossStyledEdge(inside, direction);
      expect(step).not.toBeNull();
      const outside = inside.apply(step!);
      expect(stepCaretAcrossStyledEdge(outside, direction)).toBeNull();

      const afterArrow = nativeSelection(outside, cursor);

      expect(insertSlash(afterArrow)).toBe(expected);
    },
  );

  it("updates a moved caret and drops its previous typing marks", () => {
    const inside = stateAt("**bold** tail", 1);
    const marked = inside.apply(inside.tr.setStoredMarks([schema.marks.bold!.create()]));

    const moved = nativeSelection(marked, 6);

    expect(insertSlash(moved)).toBe("**bold** /tail");
  });

  it.each([
    { cursor: 1, expected: "/abc" },
    { cursor: 4, expected: "abc/" },
  ])("collapses a range at $cursor before inserting", ({ cursor, expected }) => {
    const selected = stateAt("abc", 1, 4);

    const collapsed = nativeSelection(selected, cursor);

    expect(insertSlash(collapsed)).toBe(expected);
  });
});
