import { assert, it } from "@effect/vitest";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Tracer from "effect/Tracer";
import * as HttpClient from "effect/http/HttpClient";

import * as HostProcess from "@t3tools/shared/HostProcess";

import * as AnalyticsService from "./AnalyticsService.ts";

it.effect("does not collect identities or export analytics despite explicit consent", () =>
  Effect.gen(function* () {
    let requests = 0;
    const spans: Array<string> = [];
    const tracer = Tracer.make({
      span(options) {
        spans.push(options.name);
        return new Tracer.NativeSpan(options);
      },
    });
    const client = HttpClient.make(() => {
      requests += 1;
      return Effect.die("Unexpected upstream analytics request");
    });
    const env = {
      T3CODE_TELEMETRY_ENABLED: "true",
      T3CODE_POSTHOG_HOST: "https://ingest.example.test",
      T3CODE_POSTHOG_KEY: "test-key",
    };

    yield* Effect.gen(function* () {
      const analytics = yield* AnalyticsService.AnalyticsService;
      for (let index = 0; index < 25; index += 1) {
        yield* analytics.record("test.disabled", { index });
      }
      yield* analytics.recordOwners([{ source: "device", ownerId: "test-device" }], "client");
      yield* analytics.flush;
    }).pipe(
      Effect.provide(
        Layer.mergeAll(
          AnalyticsService.layer,
          ConfigProvider.layer(ConfigProvider.fromEnv({ env })),
        ),
      ),
      Effect.provideService(HostProcess.Environment, env),
      Effect.provideService(HttpClient.HttpClient, client),
      Effect.withTracer(tracer),
    );

    assert.equal(requests, 0);
    assert.deepEqual(spans, []);
  }),
);
