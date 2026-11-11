import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import type { TelemetryOwner } from "./Identify.ts";

export class AnalyticsService extends Context.Service<
  AnalyticsService,
  {
    readonly record: (
      event: string,
      properties?: Readonly<Record<string, unknown>>,
    ) => Effect.Effect<void>;
    readonly flush: Effect.Effect<void>;
    readonly recordOwners: (
      owners: ReadonlyArray<TelemetryOwner>,
      observedBy: "server" | "client",
    ) => Effect.Effect<void>;
  }
>()("t3/telemetry/AnalyticsService") {}

// Fork builds never collect or export product analytics.
export const layer = Layer.succeed(
  AnalyticsService,
  AnalyticsService.of({
    // Per-RPC no-ops must not create spans in the user's diagnostic exporter.
    record: Effect.fn(() => Effect.void),
    flush: Effect.void,
    recordOwners: Effect.fn(() => Effect.void),
  }),
);
