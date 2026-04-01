import { getSecureStorage } from '../../utils/secureStorage/index.js'

const SECRET_NAMESPACE = 'model-gateway'

function getSecretKey(providerId: string): string {
  return `${SECRET_NAMESPACE}:${providerId}`
}

export function readGatewayProviderSecret(providerId: string): string | undefined {
  const value = getSecureStorage().read()?.pluginSecrets?.[getSecretKey(providerId)]
  if (!value || typeof value !== 'object') {
    return undefined
  }
  const apiKey = (value as Record<string, unknown>).apiKey
  return typeof apiKey === 'string' && apiKey.length > 0 ? apiKey : undefined
}

export function writeGatewayProviderSecret(providerId: string, apiKey: string): void {
  const storage = getSecureStorage()
  const existing = storage.read() ?? {}
  if (!existing.pluginSecrets) {
    existing.pluginSecrets = {}
  }
  existing.pluginSecrets[getSecretKey(providerId)] = { apiKey }
  const result = storage.update(existing)
  if (!result.success) {
    throw new Error(`Failed to save API key for provider ${providerId}`)
  }
}
