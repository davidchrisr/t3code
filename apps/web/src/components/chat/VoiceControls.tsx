import { useAtomValue } from "@effect/atom-react";
import { use, useEffect, useRef, useState } from "react";
import type {
  EnvironmentId,
  ProviderDriverKind,
  ThreadId,
  ResolvedKeybindingsConfig,
} from "@t3tools/contracts";
import { AudioLinesIcon, MicIcon, MicOffIcon, SquareIcon } from "lucide-react";
import { Button } from "../ui/button";
import { Toggle } from "../ui/toggle";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { Spinner } from "../ui/spinner";
import { ComposerBanner } from "./ComposerBanner";
import { BackgroundThreadContext } from "./backgroundThread";
import { threadEnvironment } from "../../state/threads";
import {
  isVoiceTargetFor,
  toggleThreadVoice,
  voiceMode,
  useVoiceState,
  useVoicePhaseFor,
} from "../../voice/voiceMode";
import { resolveVoiceAvailability, voiceBrowserSupport } from "../../voice/voiceAvailability";
import { resolveShortcutCommand } from "../../keybindings";
import { isCommandPaletteOpen } from "../../commandPaletteBus";
import { getTerminalFocusOwner } from "../../lib/terminalFocus";
import { useStableCallback } from "../../hooks/useStableCallback";
import { useMediaQuery } from "../../hooks/useMediaQuery";
import type { Thread } from "../../types";

export function useVoiceControls(props: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId | null;
  readonly provider: ProviderDriverKind | undefined;
  readonly prepareThread?: (signal: AbortSignal) => Promise<void>;
  readonly canOperateThread: boolean;
  readonly unavailableReason: string | null;
  readonly keybindings: ResolvedKeybindingsConfig;
  readonly thread: Thread | null | undefined;
}) {
  const backgroundThread = use(BackgroundThreadContext);
  const permitted = useAtomValue(
    threadEnvironment.voiceSession.permissionAtom(props.environmentId),
  );
  const phase = useVoicePhaseFor(props.environmentId, props.threadId);
  const active = phase !== "idle";
  const availability = resolveVoiceAvailability({
    provider: props.provider,
    hasThread: props.threadId !== null,
    permitted: permitted && props.canOperateThread,
    unavailableReason: props.unavailableReason,
    thread: props.thread ?? null,
    ...voiceBrowserSupport(),
  });
  const toggleVoice = useStableCallback(() =>
    toggleThreadVoice(
      props.threadId === null
        ? null
        : { environmentId: props.environmentId, threadId: props.threadId },
      availability,
      props.prepareThread,
    ),
  );
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Release microphone capture when its owning composer changes thread or unmounts.
  useEffect(
    () => () => {
      const state = voiceMode.getState();
      if (
        props.threadId !== null &&
        isVoiceTargetFor(state, { environmentId: props.environmentId, threadId: props.threadId })
      )
        voiceMode.stop();
    },
    [props.environmentId, props.threadId],
  );
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Release capture when the environment revokes access or the selected provider becomes unavailable.
  useEffect(() => {
    if (active && availability.kind !== "ready") voiceMode.stop();
  }, [active, availability.kind]);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Attach voice shortcuts to the browser's global keyboard event.
  useEffect(() => {
    if (backgroundThread) return;
    const handler = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat || event.isComposing || isCommandPaletteOpen())
        return;
      const command = resolveShortcutCommand(event, props.keybindings, {
        context: { terminalFocus: getTerminalFocusOwner() !== null },
      });
      const sessionActive = voiceMode.getState().phase !== "idle";
      if (command === "voice.toggle" && (sessionActive || availability.kind !== "unsupported")) {
        event.preventDefault();
        event.stopPropagation();
        if (sessionActive) voiceMode.stop();
        else toggleVoice();
      } else if (command === "voice.toggleMute" && sessionActive) {
        event.preventDefault();
        event.stopPropagation();
        voiceMode.toggleMute();
      }
    };
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [availability.kind, backgroundThread, props.keybindings, toggleVoice]);
  return { active, availability, toggleVoice };
}

export function ComposerVoiceButton(props: {
  readonly active: boolean;
  readonly disabledReason: string | null;
  readonly onToggle: () => void;
}) {
  const label = props.active ? "Stop voice conversation" : "Start voice conversation";
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Toggle
            variant="ghost"
            size="sm"
            pressed={props.active}
            aria-label={label}
            aria-disabled={props.disabledReason !== null || undefined}
            onPointerDown={(event) => event.preventDefault()}
            onPressedChange={() => {
              if (props.disabledReason === null) props.onToggle();
            }}
          />
        }
      >
        <AudioLinesIcon />
      </TooltipTrigger>
      <TooltipPopup>{props.disabledReason ?? label}</TooltipPopup>
    </Tooltip>
  );
}

const METER_GAINS = [0.45, 0.8, 1, 0.75, 0.5];

function drawMeter(element: HTMLSpanElement | null, level: number) {
  if (!element) return;
  for (const [index, gain] of METER_GAINS.entries()) {
    const bar = element.children[index];
    if (bar instanceof HTMLElement)
      bar.style.transform = `scaleY(${Math.max(0.12, Math.min(1, Math.sqrt(level) * 2 * gain))})`;
  }
}

function LevelMeter({
  label,
  meterRef,
}: {
  readonly label: string;
  readonly meterRef: React.RefObject<HTMLSpanElement | null>;
}) {
  return (
    <span ref={meterRef} role="img" aria-label={label} className="flex h-3.5 items-center gap-px">
      {METER_GAINS.map((gain) => (
        <span
          key={gain}
          className="h-full w-0.5 origin-center rounded-full bg-current [transform:scaleY(0.12)]"
        />
      ))}
    </span>
  );
}

function VoiceActivity(props: { readonly connecting: boolean; readonly muted: boolean }) {
  const microphone = useRef<HTMLSpanElement>(null);
  const speaker = useRef<HTMLSpanElement>(null);
  const reducedMotion = useMediaQuery("(prefers-reduced-motion: reduce)");
  const [speaking, setSpeaking] = useState(false);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Subscribe meter DOM elements to audio samples without rerendering the composer.
  useEffect(() => {
    let quietSamples = 0;
    let wasSpeaking: boolean | undefined;
    return voiceMode.subscribeLevels((levels) => {
      quietSamples = levels.speaker > 0.02 ? 0 : quietSamples + 1;
      const nextSpeaking = levels.speaker > 0.02 || (wasSpeaking === true && quietSamples < 3);
      if (nextSpeaking !== wasSpeaking) {
        wasSpeaking = nextSpeaking;
        setSpeaking(nextSpeaking);
      }
      drawMeter(microphone.current, reducedMotion ? (props.muted ? 0 : 0.04) : levels.microphone);
      drawMeter(speaker.current, reducedMotion ? (nextSpeaking ? 0.04 : 0) : levels.speaker);
    });
  }, [reducedMotion, props.muted]);
  const status = props.connecting
    ? "Connecting..."
    : speaking
      ? "Speaking"
      : props.muted
        ? "Muted"
        : "Listening";
  return (
    <>
      <span role="status" className="shrink-0 whitespace-nowrap">
        {status}
      </span>
      <span className="flex items-center gap-1 text-muted-foreground">
        {props.muted ? <MicOffIcon className="size-3" /> : <MicIcon className="size-3" />}
        <LevelMeter label="Microphone level" meterRef={microphone} />
      </span>
      <span className="flex items-center gap-1 text-muted-foreground">
        <AudioLinesIcon className="size-3" />
        <LevelMeter label="Speaker level" meterRef={speaker} />
      </span>
    </>
  );
}

export function VoiceControls(props: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
}) {
  const state = useVoiceState();
  if (!isVoiceTargetFor(state, props) || (state.phase === "idle" && !state.error)) return null;
  const active = state.phase !== "idle";
  return (
    <ComposerBanner.Attachment>
      <ComposerBanner.Root
        data-chat-composer-voice-strip="true"
        variant={state.error ? "error" : "info"}
      >
        <ComposerBanner.Row layout="wrap-actions">
          <ComposerBanner.Icon>
            {state.phase === "connecting" ? <Spinner /> : <AudioLinesIcon />}
          </ComposerBanner.Icon>
          <ComposerBanner.Content className="gap-2">
            {active ? (
              <VoiceActivity connecting={state.phase === "connecting"} muted={state.muted} />
            ) : (
              "Voice stopped"
            )}
          </ComposerBanner.Content>
          <ComposerBanner.Actions>
            {active ? (
              <>
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <Button
                        variant="glass"
                        size="icon-xs"
                        aria-label={state.muted ? "Unmute microphone" : "Mute microphone"}
                        aria-pressed={state.muted}
                        onClick={voiceMode.toggleMute}
                      />
                    }
                  >
                    {state.muted ? (
                      <MicOffIcon aria-hidden className="size-3 text-destructive-foreground" />
                    ) : (
                      <MicIcon aria-hidden className="size-3" />
                    )}
                  </TooltipTrigger>
                  <TooltipPopup>
                    {state.muted ? "Unmute microphone" : "Mute microphone"}
                  </TooltipPopup>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <Button
                        variant="glass"
                        size="icon-xs"
                        aria-label="Stop voice conversation"
                        onClick={voiceMode.stop}
                      />
                    }
                  >
                    <SquareIcon aria-hidden className="size-2 fill-current" />
                  </TooltipTrigger>
                  <TooltipPopup>Stop voice conversation</TooltipPopup>
                </Tooltip>
              </>
            ) : null}
            {state.error ? (
              <Button variant="ghost" size="xs" onClick={voiceMode.dismissError}>
                Dismiss error
              </Button>
            ) : null}
          </ComposerBanner.Actions>
        </ComposerBanner.Row>
        {state.error ? (
          <ComposerBanner.Body>
            <p role="alert">{state.error}</p>
          </ComposerBanner.Body>
        ) : null}
        {active && state.userCaption ? (
          <ComposerBanner.Body>
            <p className="line-clamp-2 text-muted-foreground">You: {state.userCaption}</p>
          </ComposerBanner.Body>
        ) : null}
        {active && state.assistantCaption ? (
          <ComposerBanner.Body>
            <p className="line-clamp-2">Voice: {state.assistantCaption}</p>
          </ComposerBanner.Body>
        ) : null}
      </ComposerBanner.Root>
    </ComposerBanner.Attachment>
  );
}
