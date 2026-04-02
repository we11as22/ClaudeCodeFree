import isEqual from 'lodash-es/isEqual.js'
import type { ModelOption } from '../../utils/model/modelOptions.js'
import { getGlobalConfig, saveGlobalConfig } from '../../utils/config.js'
import { logForDebugging } from '../../utils/debug.js'
import { logError } from '../../utils/log.js'
import { getInitialSettings } from '../../utils/settings/settings.js'
import { readGatewayProviderSecret } from './secrets.js'
import type {
  GatewayBackendType,
  GatewayCustomModelConfig,
  GatewayModelMetadata,
  GatewayProviderConfig,
} from './types.js'

type OpenAIListResponse = {
  data?: Array<{
    id?: string
    name?: string
    description?: string
    isFree?: boolean
    preferredIndex?: number
    context_length?: number
    pricing?: {
      prompt?: string
      completion?: string
    }
  }>
}

type OpenCodeListResponse = {
  data?: Array<{
    id?: string
  }>
}

type ModelsDevProviderResponse = {
  api?: string
  npm?: string
  models?: Record<
    string,
    {
      name?: string
      cost?: {
        input?: number
        output?: number
        cache_read?: number
        cache_write?: number
      }
      limit?: {
        context?: number
        input?: number
        output?: number
      }
      temperature?: boolean
      tool_call?: boolean
      interleaved?: boolean
      provider?: {
        npm?: string
        api?: string
      }
    }
  >
}

const KILO_MODELS_URL = 'https://api.kilo.ai/api/gateway/models'
const KILO_GATEWAY_BASE_URL = 'https://api.kilo.ai/api/gateway'
const KILO_ANONYMOUS_API_KEY = 'anonymous'
const OPENCODE_MODELS_URL = 'https://opencode.ai/zen/v1/models'
const OPENCODE_BASE_URL = 'https://opencode.ai/zen/v1'
const MODELS_DEV_API_URL = 'https://models.dev/api.json'
const OPENCODE_PUBLIC_API_KEY = 'public'
const EXTERNAL_MODEL_PREFIX = 'ext:'

function createExternalValue(source: string, model: string): string {
  return `${EXTERNAL_MODEL_PREFIX}${source}:${model}`
}

function parseExternalValue(model: string): { source: string; model: string } | null {
  if (!model.startsWith(EXTERNAL_MODEL_PREFIX)) {
    return null
  }
  const body = model.slice(EXTERNAL_MODEL_PREFIX.length)
  const separatorIndex = body.indexOf(':')
  if (separatorIndex === -1) {
    return null
  }
  return {
    source: body.slice(0, separatorIndex),
    model: body.slice(separatorIndex + 1),
  }
}

function formatPriceLine(prompt?: string, completion?: string): string | undefined {
  if (!prompt || !completion) {
    return undefined
  }
  const promptValue = Number.parseFloat(prompt)
  const completionValue = Number.parseFloat(completion)
  if (Number.isNaN(promptValue) || Number.isNaN(completionValue)) {
    return undefined
  }
  if (promptValue === 0 && completionValue === 0) {
    return 'Free'
  }
  return `$${(promptValue * 1_000_000).toFixed(2)} / $${(completionValue * 1_000_000).toFixed(2)} per 1M`
}

function formatContext(contextLength?: number): string | undefined {
  if (!contextLength || contextLength <= 0) {
    return undefined
  }
  if (contextLength >= 1_000_000) {
    return `${(contextLength / 1_000_000).toFixed(contextLength % 1_000_000 === 0 ? 0 : 1)}M ctx`
  }
  if (contextLength >= 1_000) {
    return `${Math.round(contextLength / 1_000)}k ctx`
  }
  return `${contextLength} ctx`
}

function joinDescription(parts: Array<string | undefined>): string {
  return parts.filter(Boolean).join(' · ')
}

function getKiloDescription(model: NonNullable<OpenAIListResponse['data']>[number]): string {
  return joinDescription([
    model.description?.split('\n')[0],
    formatPriceLine(model.pricing?.prompt, model.pricing?.completion),
    formatContext(model.context_length),
  ])
}

function getBackendFromNpm(npm: string | undefined): GatewayBackendType | null {
  if (!npm) {
    return null
  }
  if (npm.includes('anthropic')) {
    return 'anthropic'
  }
  if (
    npm.includes('openai') ||
    npm.includes('openrouter') ||
    npm.includes('gateway')
  ) {
    return 'openai-chat'
  }
  return null
}

function getOpenCodeBackend(
  modelId: string,
  providerInfo?: { npm?: string },
  defaultProviderNpm?: string,
): GatewayBackendType | null {
  const metadataBackend = getBackendFromNpm(providerInfo?.npm) ?? getBackendFromNpm(defaultProviderNpm)
  if (metadataBackend) {
    return metadataBackend
  }
  const lower = modelId.toLowerCase()
  if (lower.startsWith('claude-') || lower === 'big-pickle' || lower.startsWith('minimax-')) {
    return 'anthropic'
  }
  if (
    lower.startsWith('glm-') ||
    lower.startsWith('kimi-') ||
    lower.startsWith('qwen') ||
    lower.startsWith('mimo-') ||
    lower.startsWith('trinity-') ||
    lower.startsWith('nemotron-') ||
    lower.startsWith('gpt-')
  ) {
    return 'openai-chat'
  }
  return null
}

function isZeroCost(model?: {
  cost?: {
    input?: number
    output?: number
    cache_read?: number
    cache_write?: number
  }
}): boolean {
  const input = model?.cost?.input ?? 0
  const output = model?.cost?.output ?? 0
  const cacheRead = model?.cost?.cache_read ?? 0
  const cacheWrite = model?.cost?.cache_write ?? 0
  return input === 0 && output === 0 && cacheRead === 0 && cacheWrite === 0
}

function getOpenCodeDescription(
  modelId: string,
  backend: GatewayBackendType,
  isFree: boolean,
  contextWindow?: number,
): string {
  const lower = modelId.toLowerCase()
  const parts: string[] = []
  if (isFree || lower.includes('free') || lower === 'big-pickle') {
    parts.push('Free')
  }
  const context = formatContext(contextWindow)
  if (context) {
    parts.push(context)
  }
  if (backend === 'anthropic' || lower.startsWith('claude-')) {
    parts.push('OpenCode Zen Anthropic-compatible')
  } else {
    parts.push('OpenCode Zen OpenAI-compatible')
  }
  return parts.join(' · ')
}

function getCustomProviderConfigs(): Record<string, GatewayProviderConfig> {
  return getInitialSettings().gatewayProviders ?? {}
}

function getCustomModels(): GatewayCustomModelConfig[] {
  return getInitialSettings().gatewayModels ?? []
}

function createExternalOption(
  value: string,
  label: string,
  description: string,
  metadata: GatewayModelMetadata,
): ModelOption {
  return {
    value,
    label,
    description,
    source: metadata.source,
    providerId: metadata.providerId,
    isFree: metadata.isFree,
    gateway: metadata,
  }
}

function getFallbackGatewayOptions(): ModelOption[] {
  return [
    createExternalOption(
      createExternalValue('kilo', 'kilo-auto/free'),
      'Kilo Auto Free',
      'Free · Kilo Gateway',
      {
          actualModel: 'kilo-auto/free',
          backend: 'openai-chat',
          baseURL: KILO_GATEWAY_BASE_URL,
          source: 'kilo',
          providerId: 'kilo',
          isFree: true,
          apiKey: KILO_ANONYMOUS_API_KEY,
          contextWindow: 200_000,
          enableStreaming: true,
        },
      ),
    createExternalOption(
      createExternalValue('opencode', 'minimax-m2.5-free'),
      'MiniMax M2.5 Free',
      'Free · OpenCode Zen',
      {
        actualModel: 'minimax-m2.5-free',
        backend: 'anthropic',
        baseURL: OPENCODE_BASE_URL,
        source: 'opencode',
        providerId: 'opencode',
        isFree: true,
        apiKey: OPENCODE_PUBLIC_API_KEY,
        enableStreaming: true,
      },
    ),
  ]
}

async function fetchKiloGatewayOptions(): Promise<ModelOption[]> {
  const response = await fetch(KILO_MODELS_URL, {
    headers: {
      Accept: 'application/json',
    },
  })
  if (!response.ok) {
    throw new Error(`Kilo models fetch failed: ${response.status}`)
  }
  const json = (await response.json()) as OpenAIListResponse
  const options = (json.data ?? [])
    .filter(model => typeof model.id === 'string' && typeof model.name === 'string')
    .map(model =>
      createExternalOption(
        createExternalValue('kilo', model.id!),
        model.name!,
        getKiloDescription(model),
        {
          actualModel: model.id!,
          backend: 'openai-chat',
          baseURL: KILO_GATEWAY_BASE_URL,
          source: 'kilo',
          providerId: model.id!.split('/')[0] || 'kilo',
          isFree: model.isFree ?? false,
          apiKey: model.isFree ? KILO_ANONYMOUS_API_KEY : undefined,
          apiKeyEnv: 'KILO_API_KEY',
          displayName: model.name!,
          description: getKiloDescription(model),
          contextWindow: model.context_length,
          enableStreaming: true,
        },
      ),
    )

  options.sort((a, b) => {
    const aFreeRank = a.isFree ? 0 : 1
    const bFreeRank = b.isFree ? 0 : 1
    if (aFreeRank !== bFreeRank) {
      return aFreeRank - bFreeRank
    }
    return a.label.localeCompare(b.label)
  })
  return options
}

async function fetchOpenCodeGatewayOptions(): Promise<ModelOption[]> {
  const [modelsResponse, modelsDevResponse] = await Promise.all([
    fetch(OPENCODE_MODELS_URL, {
      headers: {
        Accept: 'application/json',
      },
    }),
    fetch(MODELS_DEV_API_URL, {
      headers: {
        Accept: 'application/json',
      },
    }),
  ])
  if (!modelsResponse.ok) {
    throw new Error(`OpenCode models fetch failed: ${modelsResponse.status}`)
  }
  if (!modelsDevResponse.ok) {
    throw new Error(`models.dev fetch failed: ${modelsDevResponse.status}`)
  }
  const json = (await modelsResponse.json()) as OpenCodeListResponse
  const modelsDevJson = (await modelsDevResponse.json()) as Record<string, ModelsDevProviderResponse>
  const opencodeProvider = modelsDevJson.opencode
  const options = (json.data ?? [])
    .filter(model => typeof model.id === 'string')
    .map(model => {
      const modelId = model.id!
      const modelMetadata = opencodeProvider?.models?.[modelId]
      const backend = getOpenCodeBackend(
        modelId,
        modelMetadata?.provider,
        opencodeProvider?.npm,
      )
      if (!backend) {
        return null
      }
      const isFree = isZeroCost(modelMetadata) || modelId.includes('free') || modelId === 'big-pickle'
      const contextWindow = modelMetadata?.limit?.context ?? modelMetadata?.limit?.input
      const maxOutputTokens = modelMetadata?.limit?.output
      return createExternalOption(
        createExternalValue('opencode', modelId),
        modelMetadata?.name ?? modelId,
        getOpenCodeDescription(modelId, backend, isFree, contextWindow),
        {
          actualModel: modelId,
          backend,
          baseURL: OPENCODE_BASE_URL,
          source: 'opencode',
          providerId: 'opencode',
          isFree,
          apiKey: isFree ? OPENCODE_PUBLIC_API_KEY : undefined,
          apiKeyEnv: 'OPENCODE_API_KEY',
          displayName: modelMetadata?.name ?? modelId,
          description: getOpenCodeDescription(
            modelId,
            backend,
            isFree,
            contextWindow,
          ),
          contextWindow,
          maxOutputTokens,
          enableStreaming: true,
        },
      )
    })
    .filter((option): option is ModelOption => option !== null)

  options.sort((a, b) => a.label.localeCompare(b.label))
  return options
}

function getCustomGatewayOptions(): ModelOption[] {
  const providerConfigs = getCustomProviderConfigs()
  return getCustomModels()
    .map(model => {
      const provider = providerConfigs[model.provider]
      if (!provider) {
        return null
      }
      const actualModel = model.model ?? model.id
      const displayName = model.name ?? model.model ?? model.id
      return createExternalOption(
        createExternalValue('custom', model.id),
        displayName,
        model.description ??
          joinDescription([
            provider.name ?? model.provider,
            model.free ? 'Free' : undefined,
            provider.type === 'anthropic'
              ? 'Anthropic-compatible'
              : 'OpenAI-compatible',
          ]),
        {
          actualModel,
          backend: model.backend ?? provider.type,
          baseURL: provider.baseURL,
          source: 'custom',
          providerId: model.provider,
          isFree: model.free ?? false,
          apiKey: provider.apiKey ?? readGatewayProviderSecret(model.provider),
          apiKeyEnv: provider.apiKeyEnv,
          headers: {
            ...(provider.headers ?? {}),
            ...(model.headers ?? {}),
          },
          body: {
            ...(provider.body ?? {}),
            ...(model.body ?? {}),
          },
          displayName,
          description:
            model.description ??
            joinDescription([
              provider.name ?? model.provider,
              model.free ? 'Free' : undefined,
              provider.type === 'anthropic'
                ? 'Anthropic-compatible'
                : 'OpenAI-compatible',
              formatContext(model.contextWindow),
            ]),
          contextWindow: model.contextWindow,
          maxOutputTokens: model.maxOutputTokens,
          temperature: model.temperature,
          timeoutMs: model.timeoutMs ?? provider.timeoutMs,
          enableStreaming:
            model.enableStreaming ?? provider.enableStreaming ?? true,
        },
      )
    })
    .filter((option): option is ModelOption => option !== null)
}

function dedupeOptions(options: ModelOption[]): ModelOption[] {
  const result: ModelOption[] = []
  const seen = new Set<string>()
  for (const option of options) {
    const key = String(option.value)
    if (seen.has(key)) {
      continue
    }
    seen.add(key)
    result.push(option)
  }
  return result
}

export async function refreshGatewayModelOptions(): Promise<void> {
  try {
    const [kiloOptions, opencodeOptions] = await Promise.all([
      fetchKiloGatewayOptions(),
      fetchOpenCodeGatewayOptions(),
    ])
    const nextOptions = dedupeOptions([
      ...kiloOptions,
      ...opencodeOptions,
      ...getCustomGatewayOptions(),
    ])
    const currentOptions = getGlobalConfig().gatewayModelOptionsCache ?? []
    if (isEqual(currentOptions, nextOptions)) {
      return
    }
    saveGlobalConfig(current => ({
      ...current,
      gatewayModelOptionsCache: nextOptions,
    }))
  } catch (error) {
    logForDebugging(
      `[ModelGateway] Failed to refresh gateway model catalog: ${error instanceof Error ? error.message : String(error)}`,
      { level: 'warn' },
    )
    logError(error as Error)
  }
}

export function getGatewayModelOptions(): ModelOption[] {
  let cached: ModelOption[] | undefined
  try {
    cached = getGlobalConfig().gatewayModelOptionsCache
  } catch {
    cached = undefined
  }
  const dynamicCustomOptions = getCustomGatewayOptions()
  const merged = dedupeOptions([
    ...(cached && cached.length > 0 ? cached : getFallbackGatewayOptions()),
    ...dynamicCustomOptions,
  ])
  return merged
}

export function isGatewayModel(model: string | null | undefined): model is string {
  return typeof model === 'string' && model.startsWith(EXTERNAL_MODEL_PREFIX)
}

export function getGatewayModelMetadata(
  model: string,
): GatewayModelMetadata | undefined {
  const parsed = parseExternalValue(model)
  if (!parsed) {
    return undefined
  }

  const option = getGatewayModelOptions().find(entry => entry.value === model)
  if (option?.gateway) {
    return option.gateway
  }

  if (parsed.source === 'custom') {
    const customModel = getCustomModels().find(entry => entry.id === parsed.model)
    if (!customModel) {
      return undefined
    }
    const provider = getCustomProviderConfigs()[customModel.provider]
    if (!provider) {
      return undefined
    }
    return {
      actualModel: customModel.model ?? customModel.id,
      backend: customModel.backend ?? provider.type,
      baseURL: provider.baseURL,
      source: 'custom',
      providerId: customModel.provider,
      isFree: customModel.free ?? false,
      apiKey: provider.apiKey ?? readGatewayProviderSecret(customModel.provider),
      apiKeyEnv: provider.apiKeyEnv,
      headers: {
        ...(provider.headers ?? {}),
        ...(customModel.headers ?? {}),
      },
      body: {
        ...(provider.body ?? {}),
        ...(customModel.body ?? {}),
      },
      displayName: customModel.name ?? customModel.model ?? customModel.id,
      description: customModel.description,
      contextWindow: customModel.contextWindow,
      maxOutputTokens: customModel.maxOutputTokens,
      temperature: customModel.temperature,
      timeoutMs: customModel.timeoutMs ?? provider.timeoutMs,
      enableStreaming:
        customModel.enableStreaming ??
        provider.enableStreaming ??
        true,
    }
  }

  if (parsed.source === 'opencode') {
    const backend = getOpenCodeBackend(parsed.model)
    if (!backend) {
      return undefined
    }
    return {
      actualModel: parsed.model,
      backend,
      baseURL: OPENCODE_BASE_URL,
      source: 'opencode',
      providerId: 'opencode',
      isFree:
        parsed.model.includes('free') ||
        parsed.model === 'big-pickle' ||
        parsed.model === 'gpt-5-nano',
      apiKey: OPENCODE_PUBLIC_API_KEY,
      apiKeyEnv: 'OPENCODE_API_KEY',
      enableStreaming: true,
    }
  }

  if (parsed.source === 'kilo') {
    return {
      actualModel: parsed.model,
      backend: 'openai-chat',
      baseURL: KILO_GATEWAY_BASE_URL,
      source: 'kilo',
      providerId: parsed.model.split('/')[0] || 'kilo',
      isFree: parsed.model === 'kilo-auto/free' || parsed.model.includes(':free'),
      apiKey: parsed.model === 'kilo-auto/free' || parsed.model.includes(':free')
        ? KILO_ANONYMOUS_API_KEY
        : undefined,
      apiKeyEnv: 'KILO_API_KEY',
      enableStreaming: true,
    }
  }

  return undefined
}

export function renderGatewayModelName(model: string): string | null {
  const option = getGatewayModelOptions().find(entry => entry.value === model)
  if (option?.label) {
    return option.label
  }
  const metadata = getGatewayModelMetadata(model)
  return metadata?.displayName ?? metadata?.actualModel ?? null
}
