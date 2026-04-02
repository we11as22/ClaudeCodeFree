import capitalize from 'lodash-es/capitalize.js'
import React, { useMemo, useState } from 'react'
import {
  readGatewayProviderSecret,
  writeGatewayProviderSecret,
} from '../services/modelGateway/secrets.js'
import { refreshGatewayModelOptions } from '../services/modelGateway/catalog.js'
import type {
  GatewayBackendType,
  GatewayCustomModelConfig,
  GatewayProviderConfig,
} from '../services/modelGateway/types.js'
import type { EffortLevel } from '../utils/effort.js'
import {
  getSettingsForSource,
  updateSettingsForSource,
} from '../utils/settings/settings.js'
import { Box, Text, useInput } from '../ink.js'
import { useKeybindings } from '../keybindings/useKeybinding.js'
import TextInput from './TextInput.js'
import { Byline } from './design-system/Byline.js'
import { KeyboardShortcutHint } from './design-system/KeyboardShortcutHint.js'
import { effortLevelToSymbol } from './EffortIndicator.js'

type Props = {
  initialModelId?: string
  onDone: (selectedModel?: string, effort?: EffortLevel) => void
  onCancel: () => void
  onTab: (reverse: boolean) => void
}

type FormFieldId =
  | 'provider'
  | 'modelApi'
  | 'apiUrl'
  | 'apiKey'
  | 'context'
  | 'temperature'
  | 'reasoning'
  | 'apply'

type ProviderPreset = {
  id: string
  label: string
  backend: GatewayBackendType
  baseURL?: string
  apiKeyEnv?: string
  enableStreaming?: boolean
  allowCustomUrl?: boolean
}

const PROVIDER_PRESETS: ProviderPreset[] = [
  { id: 'anthropic', label: 'Anthropic', backend: 'anthropic', baseURL: 'https://api.anthropic.com/v1', apiKeyEnv: 'ANTHROPIC_API_KEY', enableStreaming: true },
  { id: 'openai', label: 'OpenAI', backend: 'openai-chat', baseURL: 'https://api.openai.com/v1', apiKeyEnv: 'OPENAI_API_KEY' },
  { id: 'openrouter', label: 'OpenRouter', backend: 'openai-chat', baseURL: 'https://openrouter.ai/api/v1', apiKeyEnv: 'OPENROUTER_API_KEY' },
  { id: 'google', label: 'Google Gemini', backend: 'openai-chat', baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai', apiKeyEnv: 'GEMINI_API_KEY' },
  { id: 'groq', label: 'Groq', backend: 'openai-chat', baseURL: 'https://api.groq.com/openai/v1', apiKeyEnv: 'GROQ_API_KEY' },
  { id: 'xai', label: 'xAI', backend: 'openai-chat', baseURL: 'https://api.x.ai/v1', apiKeyEnv: 'XAI_API_KEY' },
  { id: 'deepseek', label: 'DeepSeek', backend: 'openai-chat', baseURL: 'https://api.deepseek.com/v1', apiKeyEnv: 'DEEPSEEK_API_KEY' },
  { id: 'mistral', label: 'Mistral', backend: 'openai-chat', baseURL: 'https://api.mistral.ai/v1', apiKeyEnv: 'MISTRAL_API_KEY' },
  { id: 'together', label: 'Together AI', backend: 'openai-chat', baseURL: 'https://api.together.xyz/v1', apiKeyEnv: 'TOGETHER_API_KEY' },
  { id: 'fireworks', label: 'Fireworks AI', backend: 'openai-chat', baseURL: 'https://api.fireworks.ai/inference/v1', apiKeyEnv: 'FIREWORKS_API_KEY' },
  { id: 'cerebras', label: 'Cerebras', backend: 'openai-chat', baseURL: 'https://api.cerebras.ai/v1', apiKeyEnv: 'CEREBRAS_API_KEY' },
  { id: 'perplexity', label: 'Perplexity', backend: 'openai-chat', baseURL: 'https://api.perplexity.ai', apiKeyEnv: 'PERPLEXITY_API_KEY' },
  { id: 'minimax', label: 'MiniMax', backend: 'openai-chat', baseURL: 'https://api.minimaxi.chat/v1', apiKeyEnv: 'MINIMAX_API_KEY' },
  { id: 'ollama', label: 'Ollama', backend: 'openai-chat', baseURL: 'http://localhost:11434/v1' },
  { id: 'custom-openai', label: 'Custom OpenAI-compatible', backend: 'openai-chat', allowCustomUrl: true },
  { id: 'custom-anthropic', label: 'Custom Anthropic-compatible', backend: 'anthropic', allowCustomUrl: true, enableStreaming: true },
]

const EFFORTS: EffortLevel[] = ['low', 'medium', 'high', 'max']

function parseOptionalInt(value: string): number | undefined {
  const trimmed = value.trim()
  if (!trimmed) return undefined
  const parsed = Number.parseInt(trimmed, 10)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Expected a positive integer, got "${value}"`)
  }
  return parsed
}

function parseOptionalTemperature(value: string): number | undefined {
  const trimmed = value.trim()
  if (!trimmed) return undefined
  const parsed = Number.parseFloat(trimmed)
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 2) {
    throw new Error(`Temperature must be between 0 and 2, got "${value}"`)
  }
  return parsed
}

function slugify(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
}

function maskSecret(value: string): string {
  if (!value) return 'Not set'
  if (value.length <= 6) return '******'
  return `${value.slice(0, 2)}${'*'.repeat(Math.max(4, value.length - 4))}${value.slice(-2)}`
}

export function GatewayCustomModelEditor({
  initialModelId,
  onDone,
  onCancel,
  onTab,
}: Props): React.ReactNode {
  const settings = getSettingsForSource('userSettings') ?? {}
  const existingModels = settings.gatewayModels ?? []
  const existingModel = existingModels.find(model => model.id === initialModelId)
  const existingProvider = existingModel
    ? (settings.gatewayProviders ?? {})[existingModel.provider]
    : undefined
  const hasStoredSecret = existingModel
    ? Boolean(readGatewayProviderSecret(existingModel.provider))
    : false

  const initialPresetIndex = Math.max(
    PROVIDER_PRESETS.findIndex(entry => {
      if (entry.id === existingModel?.presetId) {
        return true
      }
      if (entry.id === existingModel?.provider) {
        return true
      }
      if (!existingProvider) {
        return false
      }
      return (
        entry.backend === (existingModel?.backend ?? existingProvider.type) &&
        ((entry.allowCustomUrl && !entry.baseURL) ||
          entry.baseURL?.replace(/\/+$/, '') === existingProvider.baseURL.replace(/\/+$/, ''))
      )
    }),
    0,
  )
  const [presetIndex, setPresetIndex] = useState(initialPresetIndex)
  const [modelApi, setModelApi] = useState(existingModel?.model ?? existingModel?.id ?? '')
  const [apiUrl, setApiUrl] = useState(existingProvider?.baseURL ?? '')
  const [apiKey, setApiKey] = useState('')
  const [contextWindow, setContextWindow] = useState(existingModel?.contextWindow ? String(existingModel.contextWindow) : '')
  const [temperature, setTemperature] = useState(existingModel?.temperature !== undefined ? String(existingModel.temperature) : '')
  const [reasoning, setReasoning] = useState<EffortLevel>(existingModel?.effortLevel ?? 'medium')
  const [focusField, setFocusField] = useState<FormFieldId>('provider')
  const [status, setStatus] = useState<string | null>(null)
  const [cursorOffsets, setCursorOffsets] = useState<Record<string, number>>({
    modelApi: (existingModel?.model ?? existingModel?.id ?? '').length,
    apiUrl: (existingProvider?.baseURL ?? '').length,
    apiKey: 0,
    context: existingModel?.contextWindow ? String(existingModel.contextWindow).length : 0,
    temperature: existingModel?.temperature !== undefined ? String(existingModel.temperature).length : 0,
  })

  const preset = PROVIDER_PRESETS[presetIndex] ?? PROVIDER_PRESETS[0]
  const visibleFields = useMemo<FormFieldId[]>(() => {
    const base: FormFieldId[] = ['provider', 'modelApi']
    if (preset.allowCustomUrl) {
      base.push('apiUrl')
    }
    base.push('apiKey', 'context', 'temperature', 'reasoning', 'apply')
    return base
  }, [preset.allowCustomUrl])

  const moveFocus = (delta: 1 | -1): void => {
    const current = visibleFields.indexOf(focusField)
    const next = Math.max(0, Math.min(visibleFields.length - 1, current + delta))
    const nextField = visibleFields[next] ?? 'provider'
    setFocusField(nextField)
    setCursorOffsets(previous => ({
      ...previous,
      ...(nextField === 'modelApi' ? { modelApi: modelApi.length } : {}),
      ...(nextField === 'apiUrl' ? { apiUrl: apiUrl.length } : {}),
      ...(nextField === 'apiKey' ? { apiKey: apiKey.length } : {}),
      ...(nextField === 'context' ? { context: contextWindow.length } : {}),
      ...(nextField === 'temperature' ? { temperature: temperature.length } : {}),
    }))
  }

  useInput((input, key) => {
    if (key.escape) {
      onCancel()
      return
    }
    if (key.tab) {
      onTab(key.shift)
      return
    }
    if (focusField === 'provider' || focusField === 'reasoning' || focusField === 'apply') {
      if (key.upArrow) {
        moveFocus(-1)
      } else if (key.downArrow) {
        moveFocus(1)
      } else if (key.return && focusField === 'apply') {
        void saveModel()
      }
    }
  })

  useKeybindings(
    {
      'modelPicker:decreaseEffort': () => {
        if (focusField === 'provider') {
          setPresetIndex(previous => (previous - 1 + PROVIDER_PRESETS.length) % PROVIDER_PRESETS.length)
          return
        }
        if (focusField === 'reasoning') {
          const currentIndex = EFFORTS.indexOf(reasoning)
          setReasoning(EFFORTS[(currentIndex - 1 + EFFORTS.length) % EFFORTS.length] ?? 'medium')
        }
      },
      'modelPicker:increaseEffort': () => {
        if (focusField === 'provider') {
          setPresetIndex(previous => (previous + 1) % PROVIDER_PRESETS.length)
          return
        }
        if (focusField === 'reasoning') {
          const currentIndex = EFFORTS.indexOf(reasoning)
          setReasoning(EFFORTS[(currentIndex + 1) % EFFORTS.length] ?? 'medium')
        }
      },
    },
    {
      context: 'ModelPicker',
      isActive: focusField === 'provider' || focusField === 'reasoning',
    },
  )

  async function saveModel(): Promise<void> {
    try {
      const trimmedModelApi = modelApi.trim()
      const resolvedBaseURL = (preset.allowCustomUrl ? apiUrl : preset.baseURL ?? '').trim().replace(/\/+$/, '')

      if (!trimmedModelApi) throw new Error('Model API is required')
      if (!resolvedBaseURL) throw new Error('API URL is required')

      const providerId = preset.allowCustomUrl
        ? slugify(`${preset.id}-${resolvedBaseURL}`) || `${preset.id}-provider`
        : preset.id
      const generatedModelId = slugify(`${providerId}-${trimmedModelApi}`)
      const modelId =
        existingModel?.id ??
        (generatedModelId.length > 0 ? generatedModelId : `custom-${Date.now()}`)

      const providerConfig: GatewayProviderConfig = {
        type: preset.backend,
        name: preset.label,
        baseURL: resolvedBaseURL,
        ...(preset.apiKeyEnv ? { apiKeyEnv: preset.apiKeyEnv } : {}),
        enableStreaming: preset.enableStreaming ?? preset.backend === 'anthropic',
      }

      const modelConfig: GatewayCustomModelConfig = {
        id: modelId,
        presetId: preset.id,
        provider: providerId,
        backend: preset.backend,
        name: trimmedModelApi,
        description: `${preset.label} · Custom`,
        model: trimmedModelApi,
        ...(parseOptionalInt(contextWindow) !== undefined
          ? { contextWindow: parseOptionalInt(contextWindow) }
          : {}),
        ...(parseOptionalTemperature(temperature) !== undefined
          ? { temperature: parseOptionalTemperature(temperature) }
          : {}),
        effortLevel: reasoning,
        enableStreaming: preset.enableStreaming ?? preset.backend === 'anthropic',
      }

      const nextProviders = { ...(settings.gatewayProviders ?? {}) }
      const nextModels = [...(settings.gatewayModels ?? [])].filter(
        model => model.id !== modelId,
      )
      nextProviders[providerId] = providerConfig
      nextModels.push(modelConfig)

      if (apiKey.trim()) {
        writeGatewayProviderSecret(providerId, apiKey.trim())
      }

      const result = updateSettingsForSource('userSettings', {
        gatewayProviders: nextProviders,
        gatewayModels: nextModels,
      })
      if (result.error) throw result.error
      await refreshGatewayModelOptions()
      onDone(`ext:custom:${modelId}`, reasoning)
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error))
    }
  }

  function renderInputRow(
    id: FormFieldId,
    label: string,
    value: string,
    onChange: (value: string) => void,
    options?: { placeholder?: string; mask?: string; description?: string },
  ): React.ReactNode {
    const focused = focusField === id
    const cursorKey = id
    return (
      <Box flexDirection="column">
        <Box flexDirection="row" alignItems="center">
          <Text color={focused ? 'permission' : undefined}>
            {focused ? '› ' : '  '}
            {label}
          </Text>
          <Box flexGrow={1} marginLeft={2} borderStyle="round" borderColor={focused ? 'permission' : undefined} paddingX={1}>
            <TextInput
              value={value}
              onChange={next => {
                setStatus(null)
                onChange(next)
              }}
              onSubmit={() => moveFocus(1)}
              onHistoryUp={() => moveFocus(-1)}
              onHistoryDown={() => moveFocus(1)}
              onTab={shift => onTab(shift)}
              onExit={onCancel}
              focus={focused}
              showCursor={focused}
              multiline={false}
              disableEscapeDoublePress
              placeholder={options?.placeholder}
              mask={options?.mask}
              columns={56}
              cursorOffset={cursorOffsets[cursorKey] ?? value.length}
              onChangeCursorOffset={offset =>
                setCursorOffsets(previous => ({ ...previous, [cursorKey]: offset }))
              }
            />
          </Box>
        </Box>
        {options?.description ? <Text dimColor>    {options.description}</Text> : null}
      </Box>
    )
  }

  return (
    <Box flexDirection="column">
      <Box flexDirection="column">
        <Text color={focusField === 'provider' ? 'permission' : undefined}>
          {focusField === 'provider' ? '› ' : '  '}
          Provider
        </Text>
        <Text>
          {preset.label} <Text dimColor>← →</Text>
        </Text>
        {!preset.allowCustomUrl && preset.baseURL ? (
          <Text dimColor>  {preset.baseURL}</Text>
        ) : null}
      </Box>

      {renderInputRow('modelApi', 'Model API', modelApi, setModelApi, {
        placeholder: preset.backend === 'openai-chat' ? 'e.g. gpt-4.1-mini' : 'e.g. claude-3-7-sonnet-latest',
      })}

      {preset.allowCustomUrl
        ? renderInputRow('apiUrl', 'API URL', apiUrl, setApiUrl, {
            placeholder: preset.backend === 'openai-chat' ? 'https://example.com/v1' : 'https://example.com/v1',
          })
        : null}

      {renderInputRow('apiKey', 'API key', apiKey, setApiKey, {
        placeholder: 'API key',
        mask: '*',
        description: apiKey
          ? `Stored masked: ${maskSecret(apiKey)}`
          : hasStoredSecret
            ? 'Stored securely. Leave empty to keep the saved key.'
            : preset.apiKeyEnv
              ? `If left empty, ${preset.apiKeyEnv} is used`
              : 'Optional if your provider does not require a key',
      })}

      {renderInputRow('context', 'Context size', contextWindow, setContextWindow, {
        placeholder: 'e.g. 200000',
      })}

      {renderInputRow('temperature', 'Temperature', temperature, setTemperature, {
        placeholder: 'e.g. 0.2',
      })}

      <Box flexDirection="column">
        <Text color={focusField === 'reasoning' ? 'permission' : undefined}>
          {focusField === 'reasoning' ? '› ' : '  '}
          Reasoning
        </Text>
        <Text color={focusField === 'reasoning' ? 'claude' : undefined}>
          {effortLevelToSymbol(reasoning)} {capitalize(reasoning)} effort <Text dimColor>← → to adjust</Text>
        </Text>
      </Box>

      <Box flexDirection="column" marginTop={1}>
        <Box
          borderStyle="round"
          borderColor={focusField === 'apply' ? 'permission' : 'border'}
          paddingX={2}
        >
          <Text color={focusField === 'apply' ? 'permission' : undefined} bold={focusField === 'apply'}>
            {focusField === 'apply' ? '› ' : '  '}Примерить модель
          </Text>
        </Box>
      </Box>

      {status ? <Text color="error">{status}</Text> : null}
      <Text dimColor>
        <Byline>
          <KeyboardShortcutHint shortcut="↑/↓" action="fields" />
          <KeyboardShortcutHint shortcut="←/→" action="provider/reasoning" />
          <KeyboardShortcutHint shortcut="Tab" action="tabs" />
        </Byline>
      </Text>
    </Box>
  )
}
