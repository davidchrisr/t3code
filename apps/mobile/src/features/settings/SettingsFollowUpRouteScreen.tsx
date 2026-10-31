import { ScreenScrollView as ScrollView } from "../../components/ui/ScreenScrollView";
import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/reactivity";
import { Platform, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppText as Text } from "../../components/ui/AppText";
import { DEFAULT_FOLLOW_UP_BEHAVIOR, type FollowUpBehavior } from "../../lib/followUpBehavior";
import { mobilePreferencesAtom, updateMobilePreferencesAtom } from "../../state/preferences";
import { ListChoiceRow as SettingsChoiceRow } from "../../components/ui/ListChoiceRow";
import { SettingsSection } from "./components/SettingsSection";
import { SettingsScreen } from "./components/SettingsScreen";
import { SettingsSwitchRow } from "./components/SettingsSwitchRow";
import { DEFAULT_CLIENT_SETTINGS } from "@t3tools/contracts/settings";

const FOLLOW_UP_OPTIONS: ReadonlyArray<{
  readonly behavior: FollowUpBehavior;
  readonly label: string;
  readonly description: string;
}> = [
  {
    behavior: "queue",
    label: "Queue",
    description: "Your message waits and runs after the current turn finishes.",
  },
  {
    behavior: "steer",
    label: "Steer",
    description: "Your message reaches the agent right away, changing what it is working on.",
  },
];

export function SettingsFollowUpRouteScreen() {
  const insets = useSafeAreaInsets();
  const preferencesResult = useAtomValue(mobilePreferencesAtom);
  const savePreferences = useAtomSet(updateMobilePreferencesAtom);
  const preferencesReady = AsyncResult.isSuccess(preferencesResult) && !preferencesResult.waiting;
  const selectedBehavior = AsyncResult.isSuccess(preferencesResult)
    ? (preferencesResult.value.followUpBehavior ?? DEFAULT_FOLLOW_UP_BEHAVIOR)
    : null;

  const content = (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      showsVerticalScrollIndicator={false}
      className="flex-1"
      contentContainerClassName="gap-3 px-5 pt-4"
      contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 18) + 18 }}
    >
      <SettingsSection title="Message expansion">
        <Text className="px-2 text-sm text-foreground-muted">Default command expansion</Text>
        <Text className="px-2 text-sm text-foreground-muted">
          Choose the default expansion level. You can still expand or collapse commands while
          viewing a conversation.
        </Text>
        {(
          [
            { value: "collapsed", label: "Collapsed", description: "Show the activity summary." },
            { value: "commands", label: "Command list", description: "Show individual commands." },
            {
              value: "full",
              label: "Commands and output",
              description: "Show exact commands and their responses.",
            },
          ] as const
        ).map((option, index) => (
          <SettingsChoiceRow
            key={option.value}
            label={option.label}
            description={option.description}
            selected={
              AsyncResult.isSuccess(preferencesResult) &&
              (preferencesResult.value.commandExpansion ??
                DEFAULT_CLIENT_SETTINGS.commandExpansion) === option.value
            }
            separated={index > 0}
            disabled={!preferencesReady}
            onPress={() => savePreferences({ commandExpansion: option.value })}
          />
        ))}
        {(
          [
            {
              key: "alwaysExpandTables",
              label: "Always expand Markdown tables",
              subtitle: "Keep table messages visible when completed turns automatically collapse.",
            },
            {
              key: "alwaysExpandThoughts",
              label: "Always expand thoughts",
              subtitle: "Show live and completed thoughts in full.",
            },
            {
              key: "autoCollapseCompletedTurns",
              label: "Automatically collapse completed turns",
              subtitle: "Fold earlier messages and activity when a turn finishes.",
            },
          ] as const
        ).map(({ key, label, subtitle }) => (
          <SettingsSwitchRow
            key={key}
            label={label}
            subtitle={subtitle}
            disabled={!preferencesReady}
            value={
              AsyncResult.isSuccess(preferencesResult)
                ? (preferencesResult.value[key] ?? DEFAULT_CLIENT_SETTINGS[key])
                : DEFAULT_CLIENT_SETTINGS[key]
            }
            onValueChange={(value) => savePreferences({ [key]: value })}
          />
        ))}
      </SettingsSection>
      <SettingsSection title="While the agent is running">
        {FOLLOW_UP_OPTIONS.map((option, index) => (
          <SettingsChoiceRow
            key={option.behavior}
            label={option.label}
            description={option.description}
            selected={selectedBehavior === option.behavior}
            separated={index > 0}
            disabled={!preferencesReady}
            onPress={() => savePreferences({ followUpBehavior: option.behavior })}
          />
        ))}
      </SettingsSection>
      <Text className="px-2 text-sm text-foreground-muted">
        Long-press the send button to use the other option for a single message. With a hardware
        keyboard, hold Command while sending.
      </Text>
    </ScrollView>
  );

  return Platform.OS === "android" ? (
    <SettingsScreen title="Chat">{content}</SettingsScreen>
  ) : (
    <View collapsable={false} className="flex-1 bg-sheet">
      {content}
    </View>
  );
}
