import * as RelayTracing from "@t3tools/shared/relayTracing";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

export const layerHeadlessRelayClient = Layer.succeed(
  RelayTracing.RelayClientTracer,
  Option.none(),
);

export const layerServerRelayBroker = layerHeadlessRelayClient;
