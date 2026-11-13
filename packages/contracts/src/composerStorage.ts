import * as Schema from "effect/Schema";

import { AuthSessionId, EnvironmentId, ThreadId, TrimmedNonEmptyString } from "./baseSchemas.ts";
import { ComposerContextRecord } from "./composerContext.ts";
import { ForwardCompatibleArray } from "./baseSchemas.ts";
import { PastedTextAttachmentSource, SnapShotSource } from "./chatAttachment.ts";

const ComposerStoredImage = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  mimeType: Schema.String,
  sizeBytes: Schema.Number,
  source: Schema.optional(SnapShotSource),
  dataUrl: Schema.String,
});

const ComposerStoredFile = Schema.Struct({
  type: Schema.optionalKey(Schema.Literals(["image", "file"])),
  id: Schema.String,
  name: Schema.String,
  mimeType: Schema.String,
  sizeBytes: Schema.Number,
  attachmentId: Schema.String,
  environmentId: EnvironmentId,
  source: Schema.optional(PastedTextAttachmentSource),
  imageSource: Schema.optionalKey(SnapShotSource),
});

export const ComposerStoredPrompt = Schema.Struct({
  id: TrimmedNonEmptyString.check(Schema.isMaxLength(128)),
  createdAt: Schema.String,
  prompt: Schema.String.check(Schema.isMaxLength(120_000)),
  attachments: Schema.Array(ComposerStoredImage).check(Schema.isMaxLength(100)),
  files: Schema.optionalKey(Schema.Array(ComposerStoredFile).check(Schema.isMaxLength(100))),
  droppedImageNames: Schema.Array(Schema.String),
  unreadableImageNames: Schema.optionalKey(Schema.Array(Schema.String)),
  pendingImageCount: Schema.optionalKey(Schema.Number),
  records: Schema.optionalKey(ForwardCompatibleArray(ComposerContextRecord)),
});
export type ComposerStoredPrompt = typeof ComposerStoredPrompt.Type;

const ComposerClientId = TrimmedNonEmptyString.check(Schema.isMaxLength(128));

export const ComposerPublishInput = Schema.Struct({
  clientId: ComposerClientId,
  clientName: TrimmedNonEmptyString.check(Schema.isMaxLength(100)),
  threadId: Schema.NullOr(ThreadId),
  entries: Schema.Array(ComposerStoredPrompt).check(
    Schema.isMaxLength(20),
    Schema.makeFilter((entries) => JSON.stringify(entries).length <= 8_000_000),
    Schema.makeFilter(
      (entries) => new Set(entries.map((entry) => entry.id)).size === entries.length,
    ),
  ),
}).check(Schema.makeFilter((input) => input.threadId === null || input.entries.length <= 1));
export type ComposerPublishInput = typeof ComposerPublishInput.Type;

export const ComposerListInput = Schema.Struct({
  clientId: ComposerClientId,
  threadId: Schema.NullOr(ThreadId),
});
export type ComposerListInput = typeof ComposerListInput.Type;

export const ComposerRemoteEntry = Schema.Struct({
  sessionId: AuthSessionId,
  clientId: ComposerClientId,
  clientName: Schema.String,
  id: Schema.String,
  threadId: Schema.NullOr(ThreadId),
  snippet: Schema.String,
  attachmentCount: Schema.Number,
  updatedAt: Schema.String,
});
export type ComposerRemoteEntry = typeof ComposerRemoteEntry.Type;

export const ComposerCopyInput = Schema.Struct({
  sessionId: AuthSessionId,
  clientId: ComposerClientId,
  id: Schema.String,
  threadId: Schema.NullOr(ThreadId),
});
export type ComposerCopyInput = typeof ComposerCopyInput.Type;

export class ComposerStorageError extends Schema.TaggedError<ComposerStorageError>()(
  "ComposerStorageError",
  { message: Schema.String },
) {}
