import type { EffortLevel } from '../../utils/effort.js'

export type GatewayBackendType = 'anthropic' | 'openai-chat'

export type GatewaySource = 'kilo' | 'opencode' | 'custom'

export type GatewayProviderConfig = {
  type: GatewayBackendType
  name?: string
  baseURL: string
  apiKey?: string
  apiKeyEnv?: string
  headers?: Record<string, string>
  body?: Record<string, unknown>
  timeoutMs?: number
  enableStreaming?: boolean
}

export type GatewayCustomModelConfig = {
  id: string
  presetId?: string
  name?: string
  description?: string
  provider: string
  backend?: GatewayBackendType
  model?: string
  free?: boolean
  contextWindow?: number
  maxOutputTokens?: number
  temperature?: number
  effortLevel?: EffortLevel
  timeoutMs?: number
  enableStreaming?: boolean
  headers?: Record<string, string>
  body?: Record<string, unknown>
}

export type GatewayModelMetadata = {
  actualModel: string
  backend: GatewayBackendType
  baseURL: string
  source: GatewaySource
  providerId: string
  isFree: boolean
  apiKey?: string
  apiKeyEnv?: string
  headers?: Record<string, string>
  body?: Record<string, unknown>
  displayName?: string
  description?: string
  contextWindow?: number
  maxOutputTokens?: number
  temperature?: number
  timeoutMs?: number
  enableStreaming?: boolean
}
