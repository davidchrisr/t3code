import {
  ComposerStorageError,
  ComposerStoredPrompt,
  type AuthSessionId,
  type ComposerCopyInput,
  type ComposerListInput,
  type ComposerPublishInput,
  type ComposerRemoteEntry,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Layer from "effect/Layer";
import * as PubSub from "effect/PubSub";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";
import * as SqlClient from "effect/sql/SqlClient";
import * as SecureRandom from "effect/crypto/SecureRandom";
import { assistantCitationsToPlainText } from "@t3tools/shared/assistantCitations";
import { replaceComposerContextReferences } from "@t3tools/shared/composerContextReferences";

import * as ServerConfig from "../config.ts";
import * as SessionStore from "../auth/SessionStore.ts";
import { remintComposerAttachments } from "./composerCopy.ts";
import {
  attachmentFileExtension,
  createDeterministicAttachmentId,
  createPendingAttachmentId,
  parseThreadSegmentFromAttachmentId,
  resolveAttachmentPathById,
} from "../attachmentStore.ts";

export class ComposerStorage extends Context.Service<
  ComposerStorage,
  {
    readonly publish: (
      sessionId: AuthSessionId,
      input: ComposerPublishInput,
    ) => Effect.Effect<void, ComposerStorageError>;
    readonly list: (
      input: ComposerListInput,
    ) => Effect.Effect<ReadonlyArray<ComposerRemoteEntry>, ComposerStorageError>;
    readonly subscribe: (
      input: ComposerListInput,
    ) => Stream.Stream<ReadonlyArray<ComposerRemoteEntry>, ComposerStorageError>;
    readonly copy: (
      input: ComposerCopyInput,
    ) => Effect.Effect<ComposerStoredPrompt, ComposerStorageError>;
  }
>()("t3/composer/ComposerStorage") {}

const scopeKey = (threadId: string | null) => (threadId === null ? "stash" : `draft:${threadId}`);
const decodePrompt = Schema.decodeUnknownEffect(Schema.fromJsonString(ComposerStoredPrompt));
const encodePrompt = Schema.encodeEffect(Schema.fromJsonString(ComposerStoredPrompt));
const encodeIds = Schema.encodeEffect(Schema.fromJsonString(Schema.Array(Schema.String)));
const isStorageError = Schema.is(ComposerStorageError);

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const fs = yield* FileSystem.FileSystem;
  const config = yield* ServerConfig.ServerConfig;
  const sessions = yield* SessionStore.SessionStore;
  const random = yield* SecureRandom.SecureRandom;
  const path = yield* Path.Path;
  const filesDirectory = path.join(config.stateDir, "composer-storage");
  const changes = yield* PubSub.sliding<void>(1);
  const mutex = yield* Semaphore.make(1);
  let prunedOwners: string | undefined;
  const prune = Effect.fn("ComposerStorage.prune")(function* () {
    const activeSessionIds = (yield* sessions.listActive()).map((session) => session.sessionId);
    const owners = yield* encodeIds(activeSessionIds.toSorted());
    if (owners === prunedOwners) return activeSessionIds;
    yield* sql.withTransaction(
      Effect.gen(function* () {
        yield* sql`DELETE FROM composer_storage_entries WHERE session_id NOT IN ${sql.in(activeSessionIds)}`;
        yield* sql`DELETE FROM composer_storage_files WHERE session_id NOT IN ${sql.in(activeSessionIds)}`;
      }),
    );
    if (!(yield* fs.exists(filesDirectory))) {
      prunedOwners = owners;
      return activeSessionIds;
    }
    const files = yield* sql<{
      readonly relative_path: string;
    }>`SELECT relative_path FROM composer_storage_files`;
    const retained = new Set(
      files.flatMap((file) => [file.relative_path, `${file.relative_path}.txt`]),
    );
    for (const name of yield* fs.readDirectory(filesDirectory)) {
      if (
        retained.has(name) ||
        parseThreadSegmentFromAttachmentId(name.replace(/\.txt$/, "")) !== "composer"
      )
        continue;
      yield* fs.remove(path.join(filesDirectory, name), { force: true });
    }
    prunedOwners = owners;
    return activeSessionIds;
  });
  yield* prune();
  yield* sessions.streamChanges.pipe(
    Stream.runForEach((change) =>
      Effect.gen(function* () {
        if (change.type === "clientRemoved") {
          yield* prune().pipe(
            mutex.withPermits(1),
            Effect.catchCause((cause) =>
              Effect.logError("Could not prune shared composer files", cause),
            ),
          );
        }
        yield* PubSub.publish(changes, undefined);
      }),
    ),
    Effect.forkScoped({ startImmediately: true }),
  );

  const list = Effect.fn("ComposerStorage.list")(
    function* (input: ComposerListInput) {
      const activeSessionIds = (yield* sessions.listActive()).map((session) => session.sessionId);
      return yield* sql<ComposerRemoteEntry>`
      SELECT e.session_id AS sessionId, e.client_id AS clientId, e.client_name AS clientName,
        e.entry_id AS id, e.thread_id AS threadId, e.snippet AS snippet,
        e.attachment_count AS attachmentCount, e.updated_at AS updatedAt
      FROM composer_storage_entries e JOIN auth_sessions s ON s.session_id = e.session_id
      WHERE e.client_id <> ${input.clientId}
        AND (e.thread_id IS NULL OR e.thread_id = ${input.threadId})
        AND s.revoked_at IS NULL AND e.session_id IN ${sql.in(activeSessionIds)}
      ORDER BY e.client_id, e.thread_id IS NULL, e.updated_at DESC, e.entry_id
    `;
    },
    Effect.mapError(
      () => new ComposerStorageError({ message: "Could not load other clients' prompts." }),
    ),
  );

  const publish = Effect.fn("ComposerStorage.publish")(
    function* (sessionId: AuthSessionId, input: ComposerPublishInput) {
      const activeSessionIds = yield* prune();
      if (!activeSessionIds.includes(sessionId)) {
        return yield* new ComposerStorageError({
          message: "This client session is no longer available.",
        });
      }
      const key = scopeKey(input.threadId);
      const now = DateTime.formatIso(yield* DateTime.now);
      const createdFiles: string[] = [];
      const removedFiles: string[] = [];
      yield* sql
        .withTransaction(
          Effect.gen(function* () {
            for (const entry of input.entries) {
              for (const file of entry.files ?? []) {
                const existing = yield* sql`SELECT 1 FROM composer_storage_files
            WHERE session_id = ${sessionId} AND client_id = ${input.clientId} AND attachment_id = ${file.attachmentId}`;
                if (existing.length > 0) continue;
                const sourcePath = resolveAttachmentPathById({
                  attachmentsDir: config.attachmentsDir,
                  attachmentId: file.attachmentId,
                });
                if (sourcePath === null)
                  return yield* new ComposerStorageError({
                    message: `Attach ${file.name} again before sharing this prompt.`,
                  });
                const relativePath = createDeterministicAttachmentId(
                  "composer",
                  yield* encodeIds([sessionId, input.clientId, file.attachmentId]),
                );
                if (relativePath === null)
                  return yield* new ComposerStorageError({
                    message: "Could not allocate a shared file.",
                  });
                const destination = path.join(filesDirectory, relativePath);
                yield* fs.makeDirectory(filesDirectory, { recursive: true });
                createdFiles.push(destination, `${destination}.txt`);
                yield* fs.copyFile(sourcePath, destination);
                if (yield* fs.exists(`${sourcePath}.txt`))
                  yield* fs.copyFile(`${sourcePath}.txt`, `${destination}.txt`);
                yield* sql`INSERT INTO composer_storage_files (session_id, client_id, attachment_id, relative_path)
            VALUES (${sessionId}, ${input.clientId}, ${file.attachmentId}, ${relativePath})`;
              }
              const content = yield* encodePrompt(entry);
              const snippet = assistantCitationsToPlainText(
                replaceComposerContextReferences(entry.prompt, (reference) => reference.label),
              )
                .trim()
                .replace(/\s+/g, " ")
                .slice(0, 90);
              const attachmentCount = entry.attachments.length + (entry.files?.length ?? 0);
              yield* sql`INSERT INTO composer_storage_entries
          (session_id, client_id, client_name, scope_key, entry_id, thread_id, snippet, attachment_count, updated_at, content_json)
          VALUES (${sessionId}, ${input.clientId}, ${input.clientName}, ${key}, ${entry.id}, ${input.threadId}, ${snippet}, ${attachmentCount}, ${now}, ${content})
          ON CONFLICT (session_id, client_id, scope_key, entry_id) DO UPDATE SET
            client_name = excluded.client_name, snippet = excluded.snippet,
            attachment_count = excluded.attachment_count, updated_at = excluded.updated_at, content_json = excluded.content_json
          WHERE content_json <> excluded.content_json OR client_name <> excluded.client_name`;
            }
            const retainedIds = yield* encodeIds(input.entries.map((entry) => entry.id));
            yield* sql`DELETE FROM composer_storage_entries
        WHERE session_id = ${sessionId} AND client_id = ${input.clientId} AND scope_key = ${key}
          AND entry_id NOT IN (SELECT value FROM json_each(${retainedIds}))`;
            const unused = yield* sql<{
              readonly relative_path: string;
            }>`SELECT relative_path FROM composer_storage_files
        WHERE session_id = ${sessionId} AND client_id = ${input.clientId}
          AND attachment_id NOT IN (
            SELECT json_extract(f.value, '$.attachmentId')
            FROM composer_storage_entries e, json_each(e.content_json, '$.files') f
            WHERE e.session_id = ${sessionId} AND e.client_id = ${input.clientId}
          )`;
            for (const file of unused) {
              const filePath = path.join(filesDirectory, file.relative_path);
              removedFiles.push(filePath, `${filePath}.txt`);
              yield* sql`DELETE FROM composer_storage_files WHERE session_id = ${sessionId} AND client_id = ${input.clientId} AND relative_path = ${file.relative_path}`;
            }
          }),
        )
        .pipe(
          Effect.onError(() =>
            Effect.forEach(
              createdFiles,
              (file) => fs.remove(file, { force: true }).pipe(Effect.ignore),
              { discard: true },
            ),
          ),
        );
      yield* Effect.forEach(removedFiles, (file) => fs.remove(file, { force: true }), {
        discard: true,
      });
      yield* PubSub.publish(changes, undefined);
    },
    mutex.withPermits(1),
    Effect.mapError((error) =>
      isStorageError(error)
        ? error
        : new ComposerStorageError({ message: "Could not share this client's prompts." }),
    ),
  );

  const copy = Effect.fn("ComposerStorage.copy")(
    function* (input: ComposerCopyInput) {
      const activeSessionIds = (yield* sessions.listActive()).map((session) => session.sessionId);
      const rows = yield* sql<{ readonly content_json: string }>`
      SELECT e.content_json FROM composer_storage_entries e JOIN auth_sessions s ON s.session_id = e.session_id
      WHERE e.session_id = ${input.sessionId} AND e.client_id = ${input.clientId}
        AND e.scope_key = ${scopeKey(input.threadId)} AND e.entry_id = ${input.id}
        AND s.revoked_at IS NULL AND e.session_id IN ${sql.in(activeSessionIds)}`;
      const row = rows[0];
      if (row === undefined)
        return yield* new ComposerStorageError({ message: "This prompt is no longer available." });
      const source = yield* decodePrompt(row.content_json);
      const ids = yield* Effect.forEach(
        [...source.attachments, ...(source.files ?? [])],
        (attachment) => random.uuidV4().pipe(Effect.map((id) => [attachment.id, id] as const)),
      );
      const entry = remintComposerAttachments(source, new Map(ids));
      const files: Array<NonNullable<ComposerStoredPrompt["files"]>[number]> = [];
      const attachments = [...entry.attachments];
      const createdPaths: string[] = [];
      yield* Effect.gen(function* () {
        for (const file of entry.files ?? []) {
          const stored = yield* sql<{ readonly relative_path: string }>`
          SELECT relative_path FROM composer_storage_files
          WHERE session_id = ${input.sessionId} AND client_id = ${input.clientId} AND attachment_id = ${file.attachmentId}`;
          const data = stored[0];
          if (data === undefined)
            return yield* new ComposerStorageError({
              message: `The shared file ${file.name} is unavailable.`,
            });
          const storedPath = path.join(filesDirectory, data.relative_path);
          if (file.type === "image") {
            const bytes = yield* fs.readFile(storedPath);
            attachments.push({
              id: file.id,
              name: file.name,
              mimeType: file.mimeType,
              sizeBytes: file.sizeBytes,
              dataUrl: `data:${file.mimeType};base64,${Buffer.from(bytes).toString("base64")}`,
              ...(file.imageSource === undefined ? {} : { source: file.imageSource }),
            });
            continue;
          }
          const extension = attachmentFileExtension(file.name);
          const attachmentId = createPendingAttachmentId(extension);
          const destination = `${config.attachmentsDir}/${attachmentId}${extension}`;
          yield* fs.makeDirectory(config.attachmentsDir, { recursive: true });
          createdPaths.push(destination, `${destination}.txt`);
          yield* fs.copyFile(storedPath, destination);
          if (yield* fs.exists(`${storedPath}.txt`))
            yield* fs.copyFile(`${storedPath}.txt`, `${destination}.txt`);
          files.push({ ...file, attachmentId });
        }
      }).pipe(
        Effect.onError(() =>
          Effect.forEach(
            createdPaths,
            (path) => fs.remove(path, { force: true }).pipe(Effect.ignore),
            { discard: true },
          ),
        ),
      );
      return { ...entry, attachments, ...(entry.files === undefined ? {} : { files }) };
    },
    mutex.withPermits(1),
    Effect.mapError((error) =>
      isStorageError(error)
        ? error
        : new ComposerStorageError({ message: "Could not copy this prompt." }),
    ),
  );

  const subscribe = (input: ComposerListInput) =>
    Stream.unwrap(
      Effect.gen(function* () {
        const queue = yield* PubSub.subscribe(changes);
        return Stream.concat(Stream.succeed(undefined), Stream.fromSubscription(queue)).pipe(
          Stream.mapEffect(() => list(input)),
          Stream.changesWith(
            (before, after) =>
              before.length === after.length &&
              before.every((entry, index) => {
                const other = after[index];
                return (
                  other !== undefined &&
                  entry.sessionId === other.sessionId &&
                  entry.clientId === other.clientId &&
                  entry.clientName === other.clientName &&
                  entry.id === other.id &&
                  entry.threadId === other.threadId &&
                  entry.snippet === other.snippet &&
                  entry.attachmentCount === other.attachmentCount &&
                  entry.updatedAt === other.updatedAt
                );
              }),
          ),
        );
      }),
    );

  return ComposerStorage.of({ publish, list, subscribe, copy });
});

export const layer = Layer.effect(ComposerStorage, make);
