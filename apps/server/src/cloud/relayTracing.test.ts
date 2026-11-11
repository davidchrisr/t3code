import { assert, it } from "@effect/vitest";
import * as RelayTracing from "@t3tools/shared/relayTracing";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import { layerHeadlessRelayClient, layerServerRelayBroker } from "./relayTracing.ts";

it.effect("server relay layers never install a product tracer", () =>
  Effect.gen(function* () {
    for (const layer of [layerHeadlessRelayClient, layerServerRelayBroker]) {
      const tracer = yield* RelayTracing.RelayClientTracer.pipe(Effect.provide(layer));
      assert.isTrue(Option.isNone(tracer));
    }
  }),
);
