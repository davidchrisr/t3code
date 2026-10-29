import * as Schema from "effect/Schema";
import { EnvironmentId, MessageId, NonNegativeInt, ThreadId } from "./baseSchemas.ts";

export const ASSISTANT_CITATION_MAX_TEXT_LENGTH = 8_000;
export const ASSISTANT_CITATION_MAX_COMMENT_LENGTH = 8_000;
export const ASSISTANT_CITATION_CONTEXT_LENGTH = 32;

/** Positions are UTF-16 offsets, not Markdown offsets. */
const citationTextFields = {
  text: Schema.String.check(
    Schema.isNonEmpty(),
    Schema.isMaxLength(ASSISTANT_CITATION_MAX_TEXT_LENGTH),
  ),
  start: NonNegativeInt.check(Schema.isLessThanOrEqualTo(Number.MAX_SAFE_INTEGER)),
  end: NonNegativeInt.check(Schema.isLessThanOrEqualTo(Number.MAX_SAFE_INTEGER)),
  prefix: Schema.String.check(Schema.isMaxLength(ASSISTANT_CITATION_CONTEXT_LENGTH)),
  suffix: Schema.String.check(Schema.isMaxLength(ASSISTANT_CITATION_CONTEXT_LENGTH)),
};

const citationFields = {
  ...citationTextFields,
  environmentId: EnvironmentId.check(Schema.isMaxLength(512)),
  threadId: ThreadId.check(Schema.isMaxLength(512)),
  comment: Schema.optional(
    Schema.String.check(Schema.isMaxLength(ASSISTANT_CITATION_MAX_COMMENT_LENGTH)),
  ),
};

const HtmlRenderCitationElement = Schema.Struct({
  selector: Schema.String.check(Schema.isNonEmpty(), Schema.isMaxLength(2_000)),
  tagName: Schema.String.check(Schema.isNonEmpty(), Schema.isMaxLength(64)),
  markup: Schema.String.check(Schema.isNonEmpty(), Schema.isMaxLength(8_000)),
});

export const HtmlRenderCitationSelection = Schema.Struct({
  ...citationTextFields,
  element: Schema.optional(HtmlRenderCitationElement),
}).check(
  Schema.makeFilter(
    (selection) => selection.end > selection.start && selection.text.trim().length > 0,
  ),
);
export type HtmlRenderCitationSelection = typeof HtmlRenderCitationSelection.Type;

export const AssistantCitation = Schema.Union([
  Schema.Struct({
    ...citationFields,
    version: Schema.Literal(1),
    messageId: MessageId.check(Schema.isMaxLength(512)),
  }),
  Schema.Struct({
    ...citationFields,
    version: Schema.Literal(2),
    htmlRender: Schema.Struct({
      attachmentId: Schema.String.check(Schema.isNonEmpty(), Schema.isMaxLength(256)),
      title: Schema.String.check(Schema.isNonEmpty(), Schema.isMaxLength(200)),
      element: Schema.optional(HtmlRenderCitationElement),
    }),
  }),
]).check(
  Schema.makeFilter((citation) => citation.end > citation.start && citation.text.trim().length > 0),
);
export type AssistantCitation = typeof AssistantCitation.Type;
