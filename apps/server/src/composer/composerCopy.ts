import type { ComposerStoredPrompt } from "@t3tools/contracts";
import {
  formatComposerContextReference,
  replaceComposerContextReferences,
  toKindScopedComposerContextId,
} from "@t3tools/shared/composerContextReferences";

export function remintComposerAttachments(
  entry: ComposerStoredPrompt,
  ids: ReadonlyMap<string, string>,
): ComposerStoredPrompt {
  const copies = [
    ...entry.attachments.map((source) => ({ source, kind: "image" as const })),
    ...(entry.files ?? []).map((source) => ({ source, kind: source.type ?? "file" })),
  ].map((attachment) => ({ ...attachment, id: ids.get(attachment.source.id)! }));
  if (copies.length === 0) return entry;
  const aliases = new Map(
    copies.flatMap(({ source, id }) => [
      [source.id, id] as const,
      ...("attachmentId" in source ? [[source.attachmentId, id] as const] : []),
    ]),
  );
  const contextIds = new Map(
    copies.map(({ source, kind, id }) => [
      toKindScopedComposerContextId(kind, source.id),
      toKindScopedComposerContextId(kind, id),
    ]),
  );
  const records = entry.records?.map((record) => {
    if ((record.kind === "file" || record.kind === "image") && "attachmentId" in record) {
      const id = aliases.get(record.attachmentId);
      if (id === undefined) return record;
      const contextId = toKindScopedComposerContextId(record.kind, id);
      contextIds.set(record.contextId, contextId);
      return { ...record, attachmentId: id, contextId };
    }
    if (record.kind === "preview-annotation" && "annotationId" in record) {
      const id = ids.get(record.annotationId);
      if (id === undefined) return record;
      const contextId = toKindScopedComposerContextId(record.kind, id);
      contextIds.set(record.contextId, contextId);
      return { ...record, annotationId: id, contextId };
    }
    return record;
  });
  return {
    ...entry,
    prompt: replaceComposerContextReferences(entry.prompt, (reference) => {
      const contextId = contextIds.get(reference.contextId);
      return contextId === undefined
        ? reference.source
        : formatComposerContextReference({ ...reference, contextId });
    }),
    attachments: entry.attachments.map((attachment) => ({
      ...attachment,
      id: ids.get(attachment.id)!,
    })),
    ...(entry.files === undefined
      ? {}
      : { files: entry.files.map((file) => ({ ...file, id: ids.get(file.id)! })) }),
    ...(records === undefined
      ? {}
      : {
          records: records.map((record) =>
            record.kind === "preview-annotation" &&
            "screenshotContextId" in record &&
            record.screenshotContextId !== undefined
              ? {
                  ...record,
                  screenshotContextId:
                    contextIds.get(record.screenshotContextId) ?? record.screenshotContextId,
                }
              : record,
          ),
        }),
  };
}
