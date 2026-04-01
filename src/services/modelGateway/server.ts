import { createHash, randomUUID } from 'crypto'
import { getGatewayModelMetadata, refreshGatewayModelOptions } from './catalog.js'
import type { GatewayBackendType } from './types.js'

type GatewayServerState = {
  server?: ReturnType<typeof Bun.serve>
  baseURL?: string
}

type UpstreamEndpoint = {
  baseURL: string
  apiKey?: string
  headers?: Record<string, string>
  body?: Record<string, unknown>
  timeoutMs?: number
  source?: string
}

type AnthropicMessage = {
  role: 'user' | 'assistant'
  content:
    | string
    | Array<
        | { type: 'text'; text: string }
        | {
            type: 'image'
            source?: { type?: string; media_type?: string; data?: string }
          }
        | {
            type: 'tool_use'
            id: string
            name: string
            input: unknown
          }
        | {
            type: 'tool_result'
            tool_use_id: string
            content?: unknown
            is_error?: boolean
          }
      >
}

type AnthropicRequestBody = {
  model: string
  max_tokens?: number
  temperature?: number
  messages: AnthropicMessage[]
  system?: string | Array<{ type?: string; text?: string }>
  tools?: Array<{
    name: string
    description?: string
    input_schema?: unknown
  }>
  tool_choice?:
    | { type: 'auto' | 'any' }
    | {
        type: 'tool'
        name: string
      }
  stream?: boolean
}

type OpenAIChatCompletionResponse = {
  model?: string
  choices?: Array<{
    finish_reason?: string | null
    message?: {
      content?: string | null
      tool_calls?: Array<{
        id?: string
        type?: string
        function?: {
          name?: string
          arguments?: string
        }
      }>
      reasoning?: string | null
      reasoning_details?: Array<{
        text?: string
      }>
    }
  }>
  usage?: {
    prompt_tokens?: number
    completion_tokens?: number
    prompt_tokens_details?: {
      cached_tokens?: number
      cache_read_tokens?: number
      cache_write_tokens?: number
    }
  }
}

const state: GatewayServerState = {}

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return Response.json(body, init)
}

function getStableOpenCodeProjectId(): string {
  return createHash('sha256').update(process.cwd()).digest('hex').slice(0, 24)
}

function applySourceSpecificHeaders(
  headers: Headers,
  endpoint: UpstreamEndpoint,
): void {
  if (endpoint.source !== 'opencode') {
    return
  }

  headers.set('x-opencode-project', getStableOpenCodeProjectId())
  headers.set('x-opencode-session', randomUUID())
  headers.set('x-opencode-request', randomUUID())
  headers.set('x-opencode-client', 'cli')
}

function resolveApiKey(metadata: {
  apiKey?: string
  apiKeyEnv?: string
  isFree?: boolean
}): string | undefined {
  if (metadata.apiKeyEnv && process.env[metadata.apiKeyEnv]) {
    return process.env[metadata.apiKeyEnv]
  }
  return metadata.apiKey
}

function getTimeoutSignal(timeoutMs?: number): AbortSignal | undefined {
  const effectiveTimeoutMs =
    timeoutMs ?? parseInt(process.env.API_TIMEOUT_MS || String(600 * 1000), 10)
  return Number.isFinite(effectiveTimeoutMs) && effectiveTimeoutMs > 0
    ? AbortSignal.timeout(effectiveTimeoutMs)
    : undefined
}

function buildUpstreamRequest(
  body: AnthropicRequestBody,
  metadata: ReturnType<typeof getGatewayModelMetadata>,
): AnthropicRequestBody & Record<string, unknown> {
  const extraBody = metadata?.body ?? {}
  const maxTokens = body.max_tokens ?? metadata?.maxOutputTokens
  const temperature = body.temperature ?? metadata?.temperature

  return {
    ...extraBody,
    ...body,
    model: metadata?.actualModel ?? body.model,
    stream: body.stream ?? false,
    ...(maxTokens !== undefined ? { max_tokens: maxTokens } : {}),
    ...(temperature !== undefined ? { temperature } : {}),
  }
}

function getSystemText(system: AnthropicRequestBody['system']): string | undefined {
  if (!system) {
    return undefined
  }
  if (typeof system === 'string') {
    return system
  }
  return system
    .map(part => part.text ?? '')
    .filter(Boolean)
    .join('\n\n')
}

function serializeToolResultContent(content: unknown): string {
  if (typeof content === 'string') {
    return content
  }
  if (Array.isArray(content)) {
    return content
      .map(item => {
        if (typeof item === 'string') {
          return item
        }
        if (
          item &&
          typeof item === 'object' &&
          'type' in item &&
          (item as { type?: string }).type === 'text' &&
          'text' in item
        ) {
          return String((item as { text?: unknown }).text ?? '')
        }
        return JSON.stringify(item)
      })
      .join('\n')
  }
  if (content == null) {
    return ''
  }
  return JSON.stringify(content)
}

function convertAnthropicMessagesToOpenAI(
  body: AnthropicRequestBody,
): Array<Record<string, unknown>> {
  const result: Array<Record<string, unknown>> = []
  const systemText = getSystemText(body.system)
  if (systemText) {
    result.push({
      role: 'system',
      content: systemText,
    })
  }

  for (const message of body.messages) {
    if (typeof message.content === 'string') {
      result.push({
        role: message.role,
        content: message.content,
      })
      continue
    }

    const textParts: Array<string> = []
    const imageParts: Array<Record<string, unknown>> = []
    const toolCalls: Array<Record<string, unknown>> = []
    const trailingMessages: Array<Record<string, unknown>> = []

    for (const block of message.content) {
      if (block.type === 'text') {
        textParts.push(block.text)
        continue
      }
      if (block.type === 'image') {
        const mediaType = block.source?.media_type ?? 'image/png'
        const data = block.source?.data ?? ''
        if (data) {
          imageParts.push({
            type: 'image_url',
            image_url: {
              url: `data:${mediaType};base64,${data}`,
            },
          })
        }
        continue
      }
      if (block.type === 'tool_use') {
        toolCalls.push({
          id: block.id,
          type: 'function',
          function: {
            name: block.name,
            arguments: JSON.stringify(block.input ?? {}),
          },
        })
        continue
      }
      if (block.type === 'tool_result') {
        trailingMessages.push({
          role: 'tool',
          tool_call_id: block.tool_use_id,
          content: serializeToolResultContent(block.content),
        })
      }
    }

    if (message.role === 'assistant') {
      result.push({
        role: 'assistant',
        content: textParts.join('\n').trim() || null,
        ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
      })
    } else if (imageParts.length > 0) {
      result.push({
        role: 'user',
        content: [
          ...(textParts.join('\n').trim()
            ? [
                {
                  type: 'text',
                  text: textParts.join('\n').trim(),
                },
              ]
            : []),
          ...imageParts,
        ],
      })
    } else if (textParts.length > 0) {
      result.push({
        role: 'user',
        content: textParts.join('\n').trim(),
      })
    }

    result.push(...trailingMessages)
  }

  return result
}

function mapStopReason(finishReason?: string | null): string | null {
  switch (finishReason) {
    case 'tool_calls':
      return 'tool_use'
    case 'length':
      return 'max_tokens'
    case 'stop':
    default:
      return 'end_turn'
  }
}

function buildAnthropicContentFromOpenAI(
  response: OpenAIChatCompletionResponse,
): {
  content: Array<Record<string, unknown>>
  stopReason: string | null
  usage: {
    input_tokens: number
    output_tokens: number
    cache_read_input_tokens?: number
    cache_creation_input_tokens?: number
  }
} {
  const choice = response.choices?.[0]
  const message = choice?.message
  const content: Array<Record<string, unknown>> = []

  const thinkingText =
    message?.reasoning_details
      ?.map(part => part.text ?? '')
      .filter(Boolean)
      .join('\n') || message?.reasoning || undefined
  if (thinkingText) {
    content.push({
      type: 'thinking',
      thinking: thinkingText,
    })
  }

  if (typeof message?.content === 'string' && message.content.trim()) {
    content.push({
      type: 'text',
      text: message.content,
    })
  }

  for (const toolCall of message?.tool_calls ?? []) {
    const argumentsText = toolCall.function?.arguments ?? '{}'
    let parsedArguments: unknown = {}
    try {
      parsedArguments = JSON.parse(argumentsText)
    } catch {
      parsedArguments = { raw: argumentsText }
    }
    content.push({
      type: 'tool_use',
      id: toolCall.id ?? `toolu_${randomUUID()}`,
      name: toolCall.function?.name ?? 'tool',
      input: parsedArguments,
    })
  }

  return {
    content,
    stopReason: mapStopReason(choice?.finish_reason),
    usage: {
      input_tokens: response.usage?.prompt_tokens ?? 0,
      output_tokens: response.usage?.completion_tokens ?? 0,
      cache_read_input_tokens:
        response.usage?.prompt_tokens_details?.cached_tokens ??
        response.usage?.prompt_tokens_details?.cache_read_tokens,
      cache_creation_input_tokens:
        response.usage?.prompt_tokens_details?.cache_write_tokens,
    },
  }
}

async function callAnthropicBackend(
  request: AnthropicRequestBody & Record<string, unknown>,
  endpoint: UpstreamEndpoint,
): Promise<Response> {
  const headers = new Headers({
    'content-type': 'application/json',
    'anthropic-version': '2023-06-01',
  })
  if (endpoint.apiKey) {
    headers.set('x-api-key', endpoint.apiKey)
    headers.set('authorization', `Bearer ${endpoint.apiKey}`)
  }
  for (const [key, value] of Object.entries(endpoint.headers ?? {})) {
    headers.set(key, value)
  }
  applySourceSpecificHeaders(headers, endpoint)

  return fetch(`${endpoint.baseURL}/messages`, {
    method: 'POST',
    headers,
    body: JSON.stringify(request),
    signal: getTimeoutSignal(endpoint.timeoutMs),
  })
}

async function callOpenAIChatBackend(
  request: AnthropicRequestBody & Record<string, unknown>,
  endpoint: UpstreamEndpoint,
): Promise<Response> {
  const headers = new Headers({
    'content-type': 'application/json',
  })
  if (endpoint.apiKey) {
    headers.set('authorization', `Bearer ${endpoint.apiKey}`)
  }
  for (const [key, value] of Object.entries(endpoint.headers ?? {})) {
    headers.set(key, value)
  }
  applySourceSpecificHeaders(headers, endpoint)

  const tools = request.tools?.map(tool => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.input_schema ?? {
        type: 'object',
        properties: {},
      },
    },
  }))

  let toolChoice: unknown
  if (request.tool_choice?.type === 'tool') {
    toolChoice = {
      type: 'function',
      function: {
        name: request.tool_choice.name,
      },
    }
  } else if (request.tool_choice?.type === 'any') {
    toolChoice = 'required'
  } else {
    toolChoice = 'auto'
  }

  return fetch(`${endpoint.baseURL}/chat/completions`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      ...(endpoint.body ?? {}),
      model: request.model,
      messages: convertAnthropicMessagesToOpenAI(request),
      max_tokens: request.max_tokens,
      stream: false,
      ...(request.temperature !== undefined
        ? { temperature: request.temperature }
        : {}),
      ...(tools && tools.length > 0 ? { tools, tool_choice: toolChoice } : {}),
    }),
    signal: getTimeoutSignal(endpoint.timeoutMs),
  })
}

async function callAnthropicStreamingBackend(
  request: AnthropicRequestBody & Record<string, unknown>,
  endpoint: UpstreamEndpoint,
): Promise<Response> {
  const headers = new Headers({
    'content-type': 'application/json',
    'anthropic-version': '2023-06-01',
  })
  if (endpoint.apiKey) {
    headers.set('x-api-key', endpoint.apiKey)
    headers.set('authorization', `Bearer ${endpoint.apiKey}`)
  }
  for (const [key, value] of Object.entries(endpoint.headers ?? {})) {
    headers.set(key, value)
  }
  applySourceSpecificHeaders(headers, endpoint)

  const upstreamResponse = await fetch(`${endpoint.baseURL}/messages`, {
    method: 'POST',
    headers,
    body: JSON.stringify(request),
    signal: getTimeoutSignal(endpoint.timeoutMs),
  })

  if (!upstreamResponse.ok) {
    return new Response(await upstreamResponse.text(), {
      status: upstreamResponse.status,
      headers: {
        'content-type':
          upstreamResponse.headers.get('content-type') ?? 'application/json',
      },
    })
  }

  return new Response(upstreamResponse.body, {
    status: upstreamResponse.status,
    headers: {
      'content-type':
        upstreamResponse.headers.get('content-type') ?? 'text/event-stream',
      'cache-control':
        upstreamResponse.headers.get('cache-control') ?? 'no-cache',
      connection: upstreamResponse.headers.get('connection') ?? 'keep-alive',
    },
  })
}

async function handleNonStreamingRequest(body: AnthropicRequestBody): Promise<Response> {
  const metadata = getGatewayModelMetadata(body.model)
  if (!metadata) {
    return jsonResponse(
      {
        error: {
          type: 'invalid_request_error',
          message: `Unknown external model: ${body.model}`,
        },
      },
      { status: 400 },
    )
  }

  const apiKey = resolveApiKey(metadata)
  const upstreamRequest = buildUpstreamRequest(
    {
      ...body,
      stream: false,
    },
    metadata,
  )

  let upstreamResponse: Response
  if (metadata.backend === 'anthropic') {
    upstreamResponse = await callAnthropicBackend(upstreamRequest, {
      baseURL: metadata.baseURL,
      apiKey,
      headers: metadata.headers,
      body: metadata.body,
      timeoutMs: metadata.timeoutMs,
      source: metadata.source,
    })
  } else {
    upstreamResponse = await callOpenAIChatBackend(upstreamRequest, {
      baseURL: metadata.baseURL,
      apiKey,
      headers: metadata.headers,
      body: metadata.body,
      timeoutMs: metadata.timeoutMs,
      source: metadata.source,
    })
  }

  if (!upstreamResponse.ok) {
    const errorText = await upstreamResponse.text()
    return new Response(errorText, {
      status: upstreamResponse.status,
      headers: {
        'content-type':
          upstreamResponse.headers.get('content-type') ?? 'application/json',
      },
    })
  }

  if (metadata.backend === 'anthropic') {
    return new Response(await upstreamResponse.text(), {
      status: 200,
      headers: {
        'content-type': 'application/json',
      },
    })
  }

  const upstreamJson = (await upstreamResponse.json()) as OpenAIChatCompletionResponse
  const anthropicPayload = buildAnthropicContentFromOpenAI(upstreamJson)
  return jsonResponse({
    id: `msg_${randomUUID()}`,
    type: 'message',
    role: 'assistant',
    model: metadata.actualModel,
    content: anthropicPayload.content,
    stop_reason: anthropicPayload.stopReason,
    stop_sequence: null,
    usage: anthropicPayload.usage,
  })
}

async function handleGatewayRequest(request: Request): Promise<Response> {
  const pathname = new URL(request.url).pathname
  if (
    request.method !== 'POST' ||
    (pathname !== '/messages' && pathname !== '/v1/messages')
  ) {
    return new Response('Not found', { status: 404 })
  }

  const body = (await request.json()) as AnthropicRequestBody
  if (body.stream) {
    const metadata = getGatewayModelMetadata(body.model)
    if (!metadata) {
      return jsonResponse(
        {
          error: {
            type: 'invalid_request_error',
            message: `Unknown external model: ${body.model}`,
          },
        },
        { status: 400 },
      )
    }
    if (metadata.backend === 'anthropic' && metadata.enableStreaming !== false) {
      const apiKey = resolveApiKey(metadata)
      return callAnthropicStreamingBackend(
        buildUpstreamRequest(
          {
            ...body,
            stream: true,
          },
          metadata,
        ),
        {
          baseURL: metadata.baseURL,
          apiKey,
          headers: metadata.headers,
          body: metadata.body,
          timeoutMs: metadata.timeoutMs,
          source: metadata.source,
        },
      )
    }
    return jsonResponse(
      {
        error: {
          type: 'not_found_error',
          message:
            'Streaming is unsupported for this external provider backend; client should retry in non-streaming mode.',
        },
      },
      { status: 404 },
    )
  }

  return handleNonStreamingRequest(body)
}

export async function ensureModelGatewayServer(): Promise<string> {
  await refreshGatewayModelOptions()
  if (state.baseURL) {
    return state.baseURL
  }

  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch: request => handleGatewayRequest(request),
  })
  state.server = server
  state.baseURL = `http://${server.hostname}:${server.port}`
  return state.baseURL
}
