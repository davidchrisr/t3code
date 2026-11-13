import * as NodeServices from "@effect/platform-node/NodeServices";
import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import { assert, it } from "@effect/vitest";
import {
  AuthSessionId,
  EnvironmentId,
  ThreadId,
  type ComposerStoredPrompt,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/sql/SqlClient";
import * as Stream from "effect/Stream";
import * as Duration from "effect/Duration";
import * as Fiber from "effect/Fiber";
import * as TestClock from "effect/testing/TestClock";
import {
  collectComposerContextReferences,
  formatComposerContextReference,
  toKindScopedComposerContextId,
} from "@t3tools/shared/composerContextReferences";

import * as ServerConfig from "../config.ts";
import * as Sqlite from "../persistence/Sqlite.ts";
import * as ComposerStorage from "./ComposerStorage.ts";
import * as SessionStore from "../auth/SessionStore.ts";
import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import * as ServerEnvironment from "../environment/ServerEnvironment.ts";

const session = AuthSessionId.make("composer-mac");
const phone = AuthSessionId.make("composer-phone");
const thread = ThreadId.make("thread-a");
const prompt: ComposerStoredPrompt = {
  id: "saved",
  createdAt: "2026-01-01T00:00:00.000Z",
  prompt: "Keep this prompt",
  attachments: [],
  droppedImageNames: [],
};
const layer = ComposerStorage.layer.pipe(
  Layer.provideMerge(SessionStore.layer),
  Layer.provide(
    Layer.succeed(ServerEnvironment.ServerEnvironmentIdentity, {
      getEnvironmentId: Effect.succeed(EnvironmentId.make("composer-test")),
    }),
  ),
  Layer.provide(ServerSecretStore.layer),
  Layer.provideMerge(Sqlite.layerMemory),
  Layer.provideMerge(ServerConfig.layerTest(process.cwd(), { prefix: "composer-storage-" })),
  Layer.provideMerge(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer)),
);

const seedSessions = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  for (const id of [session, phone]) {
    yield* sql`INSERT INTO auth_sessions
      (session_id, subject, method, issued_at, expires_at, scopes)
      VALUES (${id}, 'owner', 'browser-session-cookie', '2020-01-01', '2099-01-01', '["orchestration:read","orchestration:operate"]')`;
  }
});

it.effect("keeps each client's stash and thread draft separate and copies without consuming", () =>
  Effect.gen(function* () {
    yield* seedSessions;
    const store = yield* ComposerStorage.ComposerStorage;
    yield* store.publish(session, {
      clientId: "mac",
      clientName: "Mac",
      threadId: null,
      entries: [prompt],
    });
    yield* store.publish(session, {
      clientId: "mac",
      clientName: "Mac",
      threadId: thread,
      entries: [{ ...prompt, id: "draft" }],
    });
    yield* store.publish(phone, {
      clientId: "phone",
      clientName: "Phone",
      threadId: thread,
      entries: [{ ...prompt, id: "own" }],
    });
    const input = { clientId: "phone", threadId: thread };
    const entries = yield* store.list(input);
    assert.equal(entries.length, 2);
    assert.equal((yield* store.list({ ...input, threadId: ThreadId.make("other") })).length, 1);
    assert.deepEqual(
      yield* store.copy({ sessionId: session, clientId: "mac", id: prompt.id, threadId: null }),
      prompt,
    );
    assert.deepEqual(yield* store.list(input), entries);
    const pull = yield* Stream.toPull(store.subscribe(input));
    assert.deepEqual(yield* pull, [entries]);
    yield* store.publish(phone, {
      clientId: "mac",
      clientName: "Phone",
      threadId: null,
      entries: [],
    });
    assert.equal((yield* store.list(input)).length, 2);
    yield* store.publish(session, {
      clientId: "mac",
      clientName: "Mac",
      threadId: thread,
      entries: [],
    });
    assert.equal((yield* store.list(input)).length, 1);
    assert.equal((yield* pull)[0]?.length, 1);
    const sql = yield* SqlClient.SqlClient;
    yield* sql`UPDATE auth_sessions SET revoked_at = '2026-01-01' WHERE session_id = ${session}`;
    assert.deepEqual(yield* store.list(input), []);
    assert.equal(
      (yield* Effect.result(
        store.copy({ sessionId: session, clientId: "mac", id: prompt.id, threadId: null }),
      ))._tag,
      "Failure",
    );
  }).pipe(Effect.scoped, Effect.provide(layer)),
);

it.effect("retains independent file bytes and creates a fresh pending upload on each copy", () =>
  Effect.gen(function* () {
    yield* seedSessions;
    const store = yield* ComposerStorage.ComposerStorage;
    const config = yield* ServerConfig.ServerConfig;
    const fs = yield* FileSystem.FileSystem;
    const id = "pending-11111111-1111-4111-8111-111111111111-txt";
    yield* fs.makeDirectory(config.attachmentsDir, { recursive: true });
    const source = `${config.attachmentsDir}/${id}.txt`;
    const imageId = "pending-22222222-2222-4222-8222-222222222222";
    const imagePath = `${config.attachmentsDir}/${imageId}.png`;
    yield* fs.writeFile(imagePath, new Uint8Array([137, 80, 78, 71]));
    yield* fs.writeFileString(source, "independent bytes");
    yield* fs.writeFileString(`${source}.txt`, "extracted text");
    const filePrompt = {
      ...prompt,
      prompt:
        formatComposerContextReference({
          kind: "file",
          contextId: toKindScopedComposerContextId("file", "file"),
          label: "notes.txt",
        }) +
        " " +
        formatComposerContextReference({
          kind: "image",
          contextId: toKindScopedComposerContextId("image", "image"),
          label: "image.png",
        }),
      attachments: [
        {
          id: "inline-image",
          name: "inline.png",
          mimeType: "image/png",
          sizeBytes: 4,
          dataUrl: "data:image/png;base64,iVBORw==",
        },
      ],
      records: [
        {
          version: 1 as const,
          kind: "file" as const,
          contextId: toKindScopedComposerContextId("file", "file"),
          label: "notes.txt",
          attachmentId: "file",
          name: "notes.txt",
          mimeType: "text/plain",
          sizeBytes: 17,
        },
        {
          version: 1 as const,
          kind: "image" as const,
          contextId: toKindScopedComposerContextId("image", "image"),
          label: "image.png",
          attachmentId: "image",
          name: "image.png",
          mimeType: "image/png",
          sizeBytes: 4,
        },
        {
          version: 1 as const,
          kind: "preview-annotation" as const,
          contextId: toKindScopedComposerContextId("preview-annotation", "image"),
          label: "Inspect",
          annotationId: "image",
          pageUrl: "https://example.test",
          pageTitle: null,
          comment: "Inspect",
          targetSummary: "Region",
          styleChanges: [],
          screenshotContextId: toKindScopedComposerContextId("image", "image"),
        },
      ],
      files: [
        {
          id: "file",
          attachmentId: id,
          environmentId: EnvironmentId.make("environment"),
          name: "notes.txt",
          mimeType: "text/plain",
          sizeBytes: 17,
        },
        {
          id: "image",
          type: "image" as const,
          attachmentId: imageId,
          environmentId: EnvironmentId.make("environment"),
          name: "image.png",
          mimeType: "image/png",
          sizeBytes: 4,
        },
      ],
    };
    yield* store.publish(session, {
      clientId: "mac",
      clientName: "Mac",
      threadId: null,
      entries: [prompt],
    });
    const rejected = yield* Effect.result(
      store.publish(session, {
        clientId: "mac",
        clientName: "Mac",
        threadId: null,
        entries: [
          filePrompt,
          {
            ...prompt,
            id: "expired",
            files: [
              {
                ...filePrompt.files[0]!,
                name: "expired-notes.txt",
                attachmentId: "pending-44444444-4444-4444-8444-444444444444-txt",
              },
            ],
          },
        ],
      }),
    );
    if (rejected._tag !== "Failure") assert.fail("Expected the complete snapshot to be rejected");
    assert.include(rejected.failure.message, "expired-notes.txt");
    assert.deepEqual(yield* fs.readDirectory(`${config.stateDir}/composer-storage`), []);
    assert.deepEqual(
      yield* store.copy({ sessionId: session, clientId: "mac", id: prompt.id, threadId: null }),
      prompt,
    );
    yield* store.publish(session, {
      clientId: "mac",
      clientName: "Mac",
      threadId: null,
      entries: [filePrompt],
    });
    assert.equal(
      (yield* store.list({ clientId: "phone", threadId: null }))[0]?.snippet,
      "notes.txt image.png",
    );
    yield* fs.remove(source);
    yield* fs.remove(imagePath);
    const input = { sessionId: session, clientId: "mac", id: prompt.id, threadId: null };
    const first = yield* store.copy(input);
    const second = yield* store.copy(input);
    const copiedImage = first.attachments.find((image) => image.name === "image.png")!;
    assert.equal(copiedImage.dataUrl, "data:image/png;base64,iVBORw==");
    assert.notEqual(first.files?.[0]?.id, filePrompt.files[0]!.id);
    assert.notEqual(first.files?.[0]?.id, second.files?.[0]?.id);
    for (const image of first.attachments) {
      assert.notEqual(image.id, image.name === "image.png" ? "image" : "inline-image");
      assert.notEqual(image.id, second.attachments.find((other) => other.name === image.name)?.id);
    }
    assert.equal(
      collectComposerContextReferences(first.prompt)[0]?.contextId,
      toKindScopedComposerContextId("file", first.files![0]!.id),
    );
    assert.equal(
      first.records?.[0]?.contextId,
      toKindScopedComposerContextId("file", first.files![0]!.id),
    );
    assert.equal(
      first.records?.[1]?.contextId,
      toKindScopedComposerContextId("image", copiedImage.id),
    );
    const annotation = first.records?.find((record) => record.kind === "preview-annotation");
    assert.equal(
      annotation && "annotationId" in annotation ? annotation.annotationId : undefined,
      copiedImage.id,
    );
    assert.equal(
      annotation && "screenshotContextId" in annotation
        ? annotation.screenshotContextId
        : undefined,
      toKindScopedComposerContextId("image", copiedImage.id),
    );
    assert.notEqual(first.files?.[0]?.attachmentId, second.files?.[0]?.attachmentId);
    yield* fs.remove(`${config.attachmentsDir}/${second.files?.[0]?.attachmentId}.txt`);
    assert.equal(
      yield* fs.readFileString(`${config.attachmentsDir}/${first.files?.[0]?.attachmentId}.txt`),
      "independent bytes",
    );
    assert.equal(
      yield* fs.readFileString(
        `${config.attachmentsDir}/${first.files?.[0]?.attachmentId}.txt.txt`,
      ),
      "extracted text",
    );
    const orphan = `${config.stateDir}/composer-storage/composer-33333333-3333-4333-8333-333333333333`;
    yield* fs.writeFileString(orphan, "unreferenced bytes");
    yield* fs.writeFileString(`${orphan}.txt`, "unreferenced sidecar");
    const sql = yield* SqlClient.SqlClient;
    yield* sql`UPDATE auth_sessions SET revoked_at = '2026-01-01' WHERE session_id = ${session}`;
    yield* store.publish(phone, {
      clientId: "phone",
      clientName: "Phone",
      threadId: null,
      entries: [first],
    });
    assert.equal((yield* fs.readDirectory(`${config.stateDir}/composer-storage`)).length, 2);
    assert.equal((yield* store.list({ clientId: "observer", threadId: null })).length, 1);
    yield* store.publish(phone, {
      clientId: "phone",
      clientName: "Phone",
      threadId: null,
      entries: [],
    });
    assert.deepEqual(yield* fs.readDirectory(`${config.stateDir}/composer-storage`), []);
    assert.equal(
      yield* fs.readFileString(`${config.attachmentsDir}/${first.files?.[0]?.attachmentId}.txt`),
      "independent bytes",
    );
  }).pipe(Effect.provide(layer)),
);

it.effect(
  "keeps a renewed connected session's prompts visible and removes them on revocation",
  () =>
    Effect.gen(function* () {
      const sessions = yield* SessionStore.SessionStore;
      const store = yield* ComposerStorage.ComposerStorage;
      const input = {
        subject: "composer-relay",
        method: "dpop-access-token" as const,
        proofKeyThumbprint: "composer-key",
        ttl: Duration.hours(1),
      };
      const original = yield* sessions.issue(input);
      yield* sessions.markConnected(original.sessionId);
      const watcher = yield* sessions
        .awaitInvalidation(original.sessionId, input.proofKeyThumbprint)
        .pipe(Effect.forkScoped({ startImmediately: true }));
      yield* store.publish(original.sessionId, {
        clientId: "mac",
        clientName: "Mac",
        threadId: thread,
        entries: [prompt],
      });
      yield* TestClock.adjust(Duration.minutes(59));
      yield* sessions.issue(input);
      yield* TestClock.adjust(Duration.minutes(2));
      assert.equal((yield* store.list({ clientId: "phone", threadId: thread })).length, 1);
      const copyInput = {
        sessionId: original.sessionId,
        clientId: "mac",
        threadId: thread,
        id: prompt.id,
      };
      assert.deepEqual(yield* store.copy(copyInput), prompt);
      yield* store.publish(original.sessionId, {
        clientId: "mac",
        clientName: "Mac",
        threadId: thread,
        entries: [{ ...prompt, prompt: "Updated after renewal" }],
      });
      assert.equal((yield* store.copy(copyInput)).prompt, "Updated after renewal");
      const pull = yield* Stream.toPull(store.subscribe({ clientId: "phone", threadId: thread }));
      assert.equal((yield* pull)[0]?.length, 1);
      yield* sessions.revoke(original.sessionId);
      yield* Fiber.join(watcher);
      assert.deepEqual(yield* pull, [[]]);
      assert.deepEqual(yield* store.list({ clientId: "phone", threadId: thread }), []);
      assert.equal((yield* Effect.result(store.copy(copyInput)))._tag, "Failure");
      assert.equal(
        (yield* Effect.result(
          store.publish(original.sessionId, {
            clientId: "mac",
            clientName: "Mac",
            threadId: thread,
            entries: [prompt],
          }),
        ))._tag,
        "Failure",
      );
    }).pipe(Effect.scoped, Effect.provide(layer)),
);
