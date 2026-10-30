import * as Schema from "effect/Schema";
import { TrimmedNonEmptyString } from "./baseSchemas.ts";
import { ThreadId } from "./baseSchemas.ts";
import {
  getProviderAttachmentLimitError,
  PROVIDER_SEND_TURN_MAX_INPUT_CHARS,
  ChatAttachment,
} from "./chatAttachment.ts";
import { ModelSelection } from "./modelSelection.ts";
import { ProviderInteractionMode } from "./providerPolicy.ts";

export const ProviderSendTurnInput = Schema.Struct({
  threadId: ThreadId,
  /** Internal recovery: permits empty turns only for adapters supporting promptless continuation. */
  continuation: Schema.optional(Schema.Boolean),
  input: Schema.optional(
    TrimmedNonEmptyString.check(Schema.isMaxLength(PROVIDER_SEND_TURN_MAX_INPUT_CHARS)),
  ),
  attachments: Schema.optional(
    Schema.Array(ChatAttachment).check(
      Schema.makeFilter((attachments) => getProviderAttachmentLimitError(attachments) ?? true),
    ),
  ),
  modelSelection: Schema.optional(ModelSelection),
  interactionMode: Schema.optional(ProviderInteractionMode),
});
export type ProviderSendTurnInput = typeof ProviderSendTurnInput.Type;

export const ProviderUploadFeedbackInput = Schema.Struct({
  threadId: ThreadId,
  reason: Schema.optional(TrimmedNonEmptyString),
});
export type ProviderUploadFeedbackInput = typeof ProviderUploadFeedbackInput.Type;

export const ProviderUploadFeedbackResult = Schema.Struct({
  feedbackId: TrimmedNonEmptyString,
});
export type ProviderUploadFeedbackResult = typeof ProviderUploadFeedbackResult.Type;

export class ProviderUploadFeedbackError extends Schema.TaggedError<ProviderUploadFeedbackError>()(
  "ProviderUploadFeedbackError",
  {
    threadId: ThreadId,
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message(): string {
    return `Failed to upload feedback for thread ${this.threadId}.`;
  }
}

export const ProviderVoiceSessionInput = Schema.Struct({
  threadId: ThreadId,
  offerSdp: Schema.String.check(Schema.isNonEmpty(), Schema.isMaxLength(64 * 1024)),
});
export type ProviderVoiceSessionInput = typeof ProviderVoiceSessionInput.Type;

export const ProviderVoiceSessionEvent = Schema.Union([
  Schema.Struct({ type: Schema.Literal("answer"), sdp: Schema.String }),
  Schema.Struct({ type: Schema.Literal("started") }),
  Schema.Struct({
    type: Schema.Literal("speech.failed"),
    reason: Schema.Literals(["too-long", "provider"]),
  }),
  Schema.Struct({
    type: Schema.Literal("transcript.delta"),
    role: Schema.Literals(["user", "assistant"]),
    text: Schema.String,
  }),
  Schema.Struct({
    type: Schema.Literal("transcript.done"),
    role: Schema.Literals(["user", "assistant"]),
    text: Schema.String,
  }),
  Schema.Struct({ type: Schema.Literal("closed") }),
]);
export type ProviderVoiceSessionEvent = typeof ProviderVoiceSessionEvent.Type;

export class ProviderVoiceSessionError extends Schema.TaggedError<ProviderVoiceSessionError>()(
  "ProviderVoiceSessionError",
  {
    threadId: ThreadId,
    reason: Schema.Literals(["unavailable", "unsupported", "busy", "provider", "persistence"]),
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message(): string {
    switch (this.reason) {
      case "unavailable":
        return "Send a message in a Codex thread before starting voice.";
      case "unsupported":
        return "This provider does not support voice conversations.";
      case "busy":
        return "A voice conversation is already active in this provider session.";
      case "persistence":
        return "Could not save the voice conversation.";
      case "provider":
        return "The provider could not continue the voice conversation.";
    }
  }
}
