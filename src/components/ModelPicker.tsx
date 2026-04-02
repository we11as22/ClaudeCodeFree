import capitalize from 'lodash-es/capitalize.js'
import * as React from 'react'
import { useMemo, useState } from 'react'
import { useExitOnCtrlCDWithKeybindings } from 'src/hooks/useExitOnCtrlCDWithKeybindings.js'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from 'src/services/analytics/index.js'
import {
  FAST_MODE_MODEL_DISPLAY,
  isFastModeAvailable,
  isFastModeCooldown,
  isFastModeEnabled,
} from 'src/utils/fastMode.js'
import { useSearchInput } from '../hooks/useSearchInput.js'
import { Box, Text, useInput, useTerminalFocus } from '../ink.js'
import { useKeybindings } from '../keybindings/useKeybinding.js'
import { useSetAppState, useAppState } from '../state/AppState.js'
import {
  convertEffortValueToLevel,
  type EffortLevel,
  getDefaultEffortForModel,
  modelSupportsEffort,
  modelSupportsMaxEffort,
  resolvePickerEffortPersistence,
  toPersistableEffort,
} from '../utils/effort.js'
import {
  getDefaultMainLoopModel,
  type ModelSetting,
  modelDisplayString,
  parseUserSpecifiedModel,
} from '../utils/model/model.js'
import {
  getModelOptions,
  type ModelOption,
} from '../utils/model/modelOptions.js'
import {
  getSettingsForSource,
  updateSettingsForSource,
} from '../utils/settings/settings.js'
import { ConfigurableShortcutHint } from './ConfigurableShortcutHint.js'
import { GatewayCustomModelEditor } from './GatewayCustomModelEditor.js'
import { SearchBox } from './SearchBox.js'
import { Select } from './CustomSelect/index.js'
import { Byline } from './design-system/Byline.js'
import { KeyboardShortcutHint } from './design-system/KeyboardShortcutHint.js'
import { Pane } from './design-system/Pane.js'
import { Tab, Tabs } from './design-system/Tabs.js'
import { effortLevelToSymbol } from './EffortIndicator.js'

export type Props = {
  initial: string | null
  sessionModel?: ModelSetting
  onSelect: (model: string | null, effort: EffortLevel | undefined) => void
  onCancel?: () => void
  isStandaloneCommand?: boolean
  showFastModeNotice?: boolean
  headerText?: string
  skipSettingsWrite?: boolean
}

type PickerTabId = 'claude' | 'free' | 'custom'

const NO_PREFERENCE = '__NO_PREFERENCE__'

type SimpleOption = {
  value: string
  label: string
  description: string
}

function resolveOptionModel(value?: string): string | undefined {
  if (!value) return undefined
  return value === NO_PREFERENCE ? getDefaultMainLoopModel() : parseUserSpecifiedModel(value)
}

function getDefaultEffortLevelForOption(value: string): EffortLevel | undefined {
  const model = resolveOptionModel(value)
  return model ? getDefaultEffortForModel(model) : undefined
}

function cycleEffortLevel(
  effort: EffortLevel,
  direction: 'left' | 'right',
  includeMax: boolean,
): EffortLevel {
  const levels: EffortLevel[] = includeMax
    ? ['low', 'medium', 'high', 'max']
    : ['low', 'medium', 'high']
  const currentIndex = levels.indexOf(effort)
  const nextIndex =
    direction === 'right'
      ? (currentIndex + 1) % levels.length
      : (currentIndex - 1 + levels.length) % levels.length
  return levels[nextIndex] ?? levels[0]
}

function getInitialTab(initial: string | null, options: ModelOption[]): PickerTabId {
  if (!initial) {
    return 'claude'
  }
  const match = options.find(option => option.value === initial)
  if (!match) {
    return 'custom'
  }
  if (match.isFree) {
    return 'free'
  }
  if (match.gateway) {
    return 'custom'
  }
  return 'claude'
}

function filterOptionsByTab(options: ModelOption[], tab: Exclude<PickerTabId, 'custom'>): ModelOption[] {
  switch (tab) {
    case 'claude':
      return options.filter(
        option =>
          !option.gateway &&
          !(
            typeof option.value === 'string' &&
            option.value.startsWith('ext:')
          ),
      )
    case 'free':
      return options.filter(option => option.gateway && option.isFree)
  }
}

function isSubsequence(text: string, query: string): boolean {
  let index = 0
  for (let i = 0; i < text.length && index < query.length; i++) {
    if (text[i] === query[index]) {
      index++
    }
  }
  return index === query.length
}

function filterSearchOptions(options: SimpleOption[], query: string): SimpleOption[] {
  const trimmed = query.trim().toLowerCase()
  if (!trimmed) {
    return options
  }
  const exact = options.filter(option =>
    `${option.label} ${option.description}`.toLowerCase().includes(trimmed),
  )
  const fuzzy = options.filter(option => {
    if (exact.some(entry => entry.value === option.value)) {
      return false
    }
    return isSubsequence(
      `${option.label} ${option.description}`.toLowerCase(),
      trimmed,
    )
  })
  return [...exact, ...fuzzy]
}

function truncateDescription(description: string, maxLength = 82): string {
  if (description.length <= maxLength) {
    return description
  }
  return `${description.slice(0, maxLength - 1).trimEnd()}…`
}

function formatContextWindow(contextWindow: number | undefined): string | undefined {
  if (!contextWindow) {
    return undefined
  }
  if (contextWindow >= 1_000_000) {
    return `${(contextWindow / 1_000_000).toFixed(1)}M ctx`
  }
  return `${Math.round(contextWindow / 1_000)}k ctx`
}

function compactFreeDescription(option: ModelOption): string {
  const parts = [
    option.providerId ? capitalize(option.providerId.replace(/[-_]/g, ' ')) : undefined,
    option.isFree ? 'Free' : undefined,
    formatContextWindow(option.gateway?.contextWindow),
  ].filter(Boolean)
  return parts.join(' · ') || 'Free'
}

function EffortLevelIndicator({
  effort,
}: {
  effort: EffortLevel | undefined
}): React.ReactNode {
  return <Text color={effort ? 'claude' : 'subtle'}>{effortLevelToSymbol(effort ?? 'low')}</Text>
}

function SearchableModelTabList({
  options,
  initialValue,
  onFocus,
  onChange,
  onCancel,
  searchEnabled,
  onTab,
}: {
  options: SimpleOption[]
  initialValue: string | undefined
  onFocus: (value: string) => void
  onChange: (value: string) => void
  onCancel: () => void
  searchEnabled: boolean
  onTab: (reverse: boolean) => void
}): React.ReactNode {
  const isTerminalFocused = useTerminalFocus()
  const [searchFocused, setSearchFocused] = useState(searchEnabled)
  const {
    query,
    cursorOffset,
  } = useSearchInput({
    isActive: searchEnabled && searchFocused,
    onExit: () => setSearchFocused(false),
    onTab,
    onExitUp: () => {},
    onCancel,
    initialQuery: '',
    backspaceExitsOnEmpty: false,
  })

  const filteredOptions = useMemo(
    () => filterSearchOptions(options, query),
    [options, query],
  )

  const effectiveInitialValue =
    filteredOptions.find(option => option.value === initialValue)?.value ??
    filteredOptions[0]?.value

  if (options.length === 0) {
    return <Text dimColor>No models in this tab.</Text>
  }

  return (
    <Box flexDirection="column" gap={1}>
      {searchEnabled ? (
        <Box>
          <SearchBox
            query={query}
            cursorOffset={cursorOffset}
            isFocused={searchFocused}
            isTerminalFocused={isTerminalFocused}
            placeholder="Filter free models…"
          />
        </Box>
      ) : null}

      <Select
        key={effectiveInitialValue ?? 'empty'}
        isDisabled={searchFocused}
        defaultValue={effectiveInitialValue}
        defaultFocusValue={effectiveInitialValue}
        options={filteredOptions.map(option => ({
          ...option,
          description: truncateDescription(option.description),
        }))}
        onFocus={onFocus}
        onChange={onChange}
        onCancel={onCancel}
        visibleOptionCount={10}
        layout="compact"
        inlineDescriptions
        highlightFocusedText={false}
        onUpFromFirstItem={() => {
          if (searchEnabled) {
            setSearchFocused(true)
          }
        }}
      />

      <Text dimColor>
        {searchEnabled && searchFocused ? (
          'Type to filter · ↓ open list · Tab switch tabs'
        ) : searchEnabled ? (
          '↑ search · Tab switch tabs'
        ) : (
          'Tab switch tabs'
        )}
      </Text>
    </Box>
  )
}

export function ModelPicker({
  initial,
  sessionModel,
  onSelect,
  onCancel,
  isStandaloneCommand,
  showFastModeNotice,
  headerText,
  skipSettingsWrite,
}: Props): React.ReactNode {
  const setAppState = useSetAppState()
  const exitState = useExitOnCtrlCDWithKeybindings(
    undefined,
    onCancel
      ? () => {
          onCancel()
          return true
        }
      : undefined,
  )
  const initialValue = initial === null ? NO_PREFERENCE : initial
  const isFastMode = useAppState(state => (isFastModeEnabled() ? state.fastMode : false))
  const effortValue = useAppState(state => state.effortValue)
  const [hasToggledEffort, setHasToggledEffort] = useState(false)
  const [effort, setEffort] = useState<EffortLevel | undefined>(
    effortValue !== undefined ? convertEffortValueToLevel(effortValue) : undefined,
  )
  const [refreshNonce, setRefreshNonce] = useState(0)

  const modelOptions = useMemo(
    () => getModelOptions(isFastMode ?? false),
    [isFastMode, refreshNonce],
  )
  const optionsWithInitial = useMemo(() => {
    if (initial !== null && !modelOptions.some(option => option.value === initial)) {
      return [
        ...modelOptions,
        {
          value: initial,
          label: modelDisplayString(initial),
          description: 'Current model',
        } satisfies ModelOption,
      ]
    }
    return modelOptions
  }, [initial, modelOptions])

  const [selectedTab, setSelectedTab] = useState<PickerTabId>(
    getInitialTab(initial, optionsWithInitial),
  )
  const switchTab = React.useCallback((reverse: boolean) => {
    setSelectedTab(previous => {
      const tabs: PickerTabId[] = ['claude', 'free', 'custom']
      const currentIndex = tabs.indexOf(previous)
      const nextIndex = reverse
        ? (currentIndex - 1 + tabs.length) % tabs.length
        : (currentIndex + 1) % tabs.length
      return tabs[nextIndex] ?? 'claude'
    })
  }, [])

  const [focusedValue, setFocusedValue] = useState(initialValue)
  const currentSelectedValue = initial === null ? NO_PREFERENCE : initial
  const claudeOptions = useMemo<SimpleOption[]>(
    () =>
      filterOptionsByTab(optionsWithInitial, 'claude').map(option => ({
        label: option.label,
        description: option.description,
        value: option.value === null ? NO_PREFERENCE : option.value,
      })),
    [optionsWithInitial],
  )
  const freeOptions = useMemo<SimpleOption[]>(
    () =>
      filterOptionsByTab(optionsWithInitial, 'free').map(option => ({
        label: option.label,
        description: compactFreeDescription(option),
        value: option.value === null ? NO_PREFERENCE : option.value,
      })),
    [optionsWithInitial],
  )

  const focusedSimpleOption = [...claudeOptions, ...freeOptions].find(
    option => option.value === focusedValue,
  )
  const focusedModelName = focusedSimpleOption?.label
  const focusedModel = resolveOptionModel(focusedValue)
  const focusedSupportsEffort = focusedModel ? modelSupportsEffort(focusedModel) : false
  const focusedSupportsMax = focusedModel ? modelSupportsMaxEffort(focusedModel) : false
  const focusedDefaultEffort = focusedValue
    ? getDefaultEffortLevelForOption(focusedValue)
    : undefined
  const displayEffort = effort === 'max' && !focusedSupportsMax ? 'high' : effort

  React.useEffect(() => {
    if (!focusedValue && selectedTab !== 'custom') {
      const fallback =
        (selectedTab === 'free' ? freeOptions[0]?.value : claudeOptions[0]?.value) ??
        initialValue
      setFocusedValue(fallback)
    }
  }, [claudeOptions, freeOptions, focusedValue, initialValue, selectedTab])

  const handleFocus = (value: string): void => {
    setFocusedValue(value)
    if (!hasToggledEffort && effortValue === undefined) {
      setEffort(getDefaultEffortLevelForOption(value))
    }
  }

  useInput((_, key, event) => {
    if (!key.tab) {
      return
    }
    event.stopImmediatePropagation()
    switchTab(key.shift)
  })

  const handleSelect = (value: string, overrideEffort?: EffortLevel): void => {
    logEvent('tengu_model_command_menu_effort', {
      effort: (overrideEffort ?? effort) as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    })

    const selectedModel = resolveOptionModel(value)
    const nextEffort = overrideEffort ?? effort

    if (!skipSettingsWrite) {
      const effortLevel = resolvePickerEffortPersistence(
        nextEffort,
        getDefaultEffortLevelForOption(value),
        getSettingsForSource('userSettings')?.effortLevel,
        hasToggledEffort || overrideEffort !== undefined,
      )
      const persistable = toPersistableEffort(effortLevel)
      if (persistable !== undefined) {
        updateSettingsForSource('userSettings', {
          effortLevel: persistable,
        })
      }
      setAppState(previous => ({
        ...previous,
        effortValue: effortLevel,
      }))
    }

    const selectedEffort =
      selectedModel && modelSupportsEffort(selectedModel)
        ? nextEffort
        : overrideEffort

    if (value === NO_PREFERENCE) {
      onSelect(null, selectedEffort)
      return
    }
    onSelect(value, selectedEffort)
  }

  React.useEffect(() => {
    if (selectedTab === 'custom') {
      return
    }
    const isFreeTab = selectedTab === 'free'
    const options = isFreeTab ? freeOptions : claudeOptions
    if (!options.some(option => option.value === focusedValue)) {
      setFocusedValue(options[0]?.value ?? initialValue)
    }
  }, [claudeOptions, focusedValue, freeOptions, initialValue, selectedTab])

  React.useEffect(() => {
    if (selectedTab === 'custom') {
      return
    }
    if (!focusedSupportsEffort || hasToggledEffort || effortValue !== undefined) {
      return
    }
    setEffort(focusedDefaultEffort)
  }, [
    effortValue,
    focusedDefaultEffort,
    focusedSupportsEffort,
    hasToggledEffort,
    selectedTab,
  ])

  const content = (
    <Box flexDirection="column">
      <Box marginBottom={1} flexDirection="column">
        <Text color="remember" bold>
          Select model
        </Text>
        <Text dimColor>
          {headerText ??
            'Switch between Claude, free, and external/custom provider models. Applies to this session and future Claude Code sessions.'}
        </Text>
        {sessionModel ? (
          <Text dimColor>
            Currently using {modelDisplayString(sessionModel)} for this session (set by plan
            mode). Selecting a model will undo this.
          </Text>
        ) : null}
      </Box>

      <Box marginBottom={1}>
        <Tabs
          selectedTab={selectedTab}
          onTabChange={tab => setSelectedTab(tab as PickerTabId)}
          initialHeaderFocused={false}
          disableNavigation
        >
          <Tab id="claude" title="Claude">
            <SearchableModelTabList
              options={claudeOptions}
              initialValue={
                claudeOptions.some(option => option.value === currentSelectedValue)
                  ? currentSelectedValue
                  : claudeOptions[0]?.value
              }
              onFocus={handleFocus}
              onChange={value => handleSelect(value)}
              onCancel={onCancel ?? (() => {})}
              searchEnabled={false}
              onTab={switchTab}
            />
          </Tab>
          <Tab id="free" title="Free">
            <SearchableModelTabList
              options={freeOptions}
              initialValue={
                freeOptions.some(option => option.value === currentSelectedValue)
                  ? currentSelectedValue
                  : freeOptions[0]?.value
              }
              onFocus={handleFocus}
              onChange={value => handleSelect(value)}
              onCancel={onCancel ?? (() => {})}
              searchEnabled
              onTab={switchTab}
            />
          </Tab>
          <Tab id="custom" title="Custom">
            <GatewayCustomModelEditor
              initialModelId={initial?.startsWith('ext:custom:') ? initial.slice('ext:custom:'.length) : undefined}
              onDone={(selectedModel, selectedEffort) => {
                setRefreshNonce(previous => previous + 1)
                if (!selectedModel) {
                  return
                }
                handleSelect(selectedModel, selectedEffort)
              }}
              onCancel={onCancel ?? (() => {})}
              onTab={switchTab}
            />
          </Tab>
        </Tabs>
      </Box>

      {selectedTab !== 'custom' ? (
        <Box marginBottom={1} flexDirection="column">
          {focusedSupportsEffort ? (
            <Text dimColor>
              <EffortLevelIndicator effort={displayEffort} /> {capitalize(displayEffort)} effort
              {displayEffort === focusedDefaultEffort ? ' (default)' : ''}{' '}
              <Text color="subtle">← → to adjust</Text>
            </Text>
          ) : (
            <Text color="subtle">
              <EffortLevelIndicator effort={undefined} /> Effort not supported
              {focusedModelName ? ` for ${focusedModelName}` : ''}
            </Text>
          )}
        </Box>
      ) : null}

      {isFastModeEnabled() ? (
        showFastModeNotice ? (
          <Box marginBottom={1}>
            <Text dimColor>
              Fast mode is <Text bold>ON</Text> and available with {FAST_MODE_MODEL_DISPLAY} only
              (/fast). Switching to other models turn off fast mode.
            </Text>
          </Box>
        ) : isFastModeAvailable() && !isFastModeCooldown() ? (
          <Box marginBottom={1}>
            <Text dimColor>
              Use <Text bold>/fast</Text> to turn on Fast mode ({FAST_MODE_MODEL_DISPLAY} only).
            </Text>
          </Box>
        ) : null
      ) : null}

      {isStandaloneCommand ? (
        <Text dimColor italic>
          {exitState.pending ? (
            <>Press {exitState.keyName} again to exit</>
          ) : (
            <Byline>
              <KeyboardShortcutHint shortcut="Enter" action="confirm" />
              <ConfigurableShortcutHint
                action="select:cancel"
                context="Select"
                fallback="Esc"
                description="exit"
              />
            </Byline>
          )}
        </Text>
      ) : null}
    </Box>
  )

  useKeybindings(
    {
      'modelPicker:decreaseEffort': () => {
        if (selectedTab === 'custom' || !focusedSupportsEffort) {
          return
        }
        setEffort(previous =>
          cycleEffortLevel(
            previous ?? focusedDefaultEffort ?? 'low',
            'left',
            focusedSupportsMax,
          ),
        )
        setHasToggledEffort(true)
      },
      'modelPicker:increaseEffort': () => {
        if (selectedTab === 'custom' || !focusedSupportsEffort) {
          return
        }
        setEffort(previous =>
          cycleEffortLevel(
            previous ?? focusedDefaultEffort ?? 'low',
            'right',
            focusedSupportsMax,
          ),
        )
        setHasToggledEffort(true)
      },
    },
    {
      context: 'ModelPicker',
      isActive: selectedTab !== 'custom',
    },
  )

  if (!isStandaloneCommand) {
    return content
  }

  return <Pane color="permission">{content}</Pane>
}
