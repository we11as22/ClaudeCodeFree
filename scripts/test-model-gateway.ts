import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { enableConfigs } from '../src/utils/config.ts'
import {
  getGatewayModelOptions,
  refreshGatewayModelOptions,
} from '../src/services/modelGateway/catalog.ts'
import { ensureModelGatewayServer } from '../src/services/modelGateway/server.ts'
import { normalizeToolSchema } from '../src/utils/jsonSchemaCompat.ts'

const repoRoot = resolve(import.meta.dir, '..')

type CliResult = {
  parsed: Record<string, unknown>
  stdout: string
  stderr: string
}

async function readStream(
  stream: ReadableStream<Uint8Array> | null,
): Promise<string> {
  if (!stream) {
    return ''
  }
  return await new Response(stream).text()
}

async function runCli(
  args: string[],
  env?: Record<string, string>,
): Promise<CliResult> {
  const proc = Bun.spawn(['bun', 'dist/cli.js', ...args], {
    cwd: repoRoot,
    env: {
      ...process.env,
      ...env,
    },
    stdout: 'pipe',
    stderr: 'pipe',
  })

  const timeoutMs = 30_000
  const timeout = new Promise<never>((_, reject) => {
    const timer = setTimeout(() => {
      proc.kill()
      reject(new Error(`CLI timed out after ${timeoutMs}ms: ${args.join(' ')}`))
    }, timeoutMs)
    proc.exited.finally(() => clearTimeout(timer))
  })

  const exitCode = await Promise.race([proc.exited, timeout])
  const [stdout, stderr] = await Promise.all([
    readStream(proc.stdout),
    readStream(proc.stderr),
  ])

  assert.equal(
    exitCode,
    0,
    `CLI exited with code ${exitCode}\nSTDOUT:\n${stdout}\nSTDERR:\n${stderr}`,
  )

  const jsonLine = stdout
    .trim()
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .at(-1)
  assert.ok(jsonLine, `CLI produced no JSON output.\nSTDERR:\n${stderr}`)

  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(jsonLine!)
  } catch (error) {
    throw new Error(
      `Failed to parse CLI JSON output: ${error}\nSTDOUT:\n${stdout}\nSTDERR:\n${stderr}`,
    )
  }

  return { parsed, stdout, stderr }
}

function getResultText(parsed: Record<string, unknown>): string {
  const value = parsed.result
  assert.equal(typeof value, 'string', `Expected string result, got: ${value}`)
  return value
}

function looksLikeOk(text: string): boolean {
  return /\bok\b/i.test(text.trim())
}

async function testLiveGatewayCatalog(): Promise<void> {
  enableConfigs()
  await refreshGatewayModelOptions()
  const options = getGatewayModelOptions()

  assert.ok(options.length > 50, `Expected gateway catalog, got ${options.length}`)
  assert.ok(
    options.some(option => option.value === 'ext:kilo:kilo-auto/free'),
    'Missing Kilo free model in gateway catalog',
  )
  assert.ok(
    options.some(option => option.value === 'ext:opencode:minimax-m2.5-free'),
    'Missing OpenCode free model in gateway catalog',
  )
  assert.ok(
    options.some(option => option.isFree),
    'Expected at least one free model in gateway catalog',
  )
}

async function postAnthropicMessage(
  baseURL: string,
  model: string,
  text: string,
): Promise<Record<string, unknown>> {
  const response = await fetch(`${baseURL}/v1/messages`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'anthropic-version': '2023-06-01',
      'x-api-key': 'test',
    },
    body: JSON.stringify({
      model,
      max_tokens: 512,
      messages: [
        {
          role: 'user',
          content: [{ type: 'text', text }],
        },
      ],
      stream: false,
    }),
  })

  const payload = (await response.json()) as Record<string, unknown>
  assert.equal(
    response.status,
    200,
    `Gateway request failed for ${model}: ${JSON.stringify(payload)}`,
  )
  return payload
}

async function postToFirstAvailableModel(
  baseURL: string,
  models: string[],
  text: string,
): Promise<{ model: string; payload: Record<string, unknown> }> {
  const failures: string[] = []

  for (const model of models) {
    const response = await fetch(`${baseURL}/v1/messages`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'anthropic-version': '2023-06-01',
        'x-api-key': 'test',
      },
      body: JSON.stringify({
        model,
        max_tokens: 512,
        messages: [
          {
            role: 'user',
            content: [{ type: 'text', text }],
          },
        ],
        stream: false,
      }),
    })
    const payload = (await response.json()) as Record<string, unknown>
    if (response.status === 200) {
      return { model, payload }
    }
    failures.push(`${model}:${response.status}`)
  }

  throw new Error(
    `All candidate models failed for prompt "${text}". Attempts: ${failures.join(', ')}`,
  )
}

function extractTextBlocks(payload: Record<string, unknown>): string[] {
  const content = payload.content
  assert.ok(Array.isArray(content), 'Anthropic payload is missing content array')
  return content
    .filter(
      (block): block is { type?: string; text?: string } =>
        !!block && typeof block === 'object',
    )
    .filter(block => block.type === 'text' && typeof block.text === 'string')
    .map(block => block.text!)
}

async function testLiveGatewayRequests(): Promise<void> {
  const baseURL = await ensureModelGatewayServer()
  const options = getGatewayModelOptions()
  const openCodeCandidates = options
    .filter(option => option.source === 'opencode' && option.isFree)
    .map(option => option.value)

  const kilo = await postAnthropicMessage(
    baseURL,
    'ext:kilo:kilo-auto/free',
    'Reply with exactly: ok',
  )
  assert.ok(
    extractTextBlocks(kilo).some(looksLikeOk),
    `Kilo gateway response did not contain expected text: ${JSON.stringify(kilo)}`,
  )

  const openCode = await postToFirstAvailableModel(
    baseURL,
    openCodeCandidates,
    'Reply with exactly: ok',
  )
  assert.ok(
    extractTextBlocks(openCode.payload).some(looksLikeOk),
    `OpenCode gateway response did not contain expected text for ${openCode.model}: ${JSON.stringify(openCode.payload)}`,
  )
}

async function testCustomAnthropicProvider(): Promise<void> {
  const upstream = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    async fetch(request) {
      assert.equal(request.method, 'POST')
      assert.equal(new URL(request.url).pathname, '/messages')
      const body = (await request.json()) as Record<string, unknown>
      assert.equal(body.model, 'mock-anthropic-upstream')
      return Response.json({
        id: 'msg_mock',
        type: 'message',
        role: 'assistant',
        model: 'mock-anthropic-upstream',
        content: [{ type: 'text', text: 'ok' }],
        stop_reason: 'end_turn',
        stop_sequence: null,
        usage: {
          input_tokens: 1,
          output_tokens: 1,
        },
      })
    },
  })

  try {
    const settings = JSON.stringify({
      gatewayProviders: {
        mockanthropic: {
          type: 'anthropic',
          name: 'Mock Anthropic',
          baseURL: `http://${upstream.hostname}:${upstream.port}`,
          apiKey: 'mock-key',
        },
      },
      gatewayModels: [
        {
          id: 'mock-anthropic',
          name: 'Mock Anthropic Model',
          provider: 'mockanthropic',
          model: 'mock-anthropic-upstream',
        },
      ],
    })

    const { parsed } = await runCli([
      '--bare',
      '-p',
      '--output-format',
      'json',
      '--settings',
      settings,
      '--model',
      'ext:custom:mock-anthropic',
      'Reply with exactly: ok',
    ])

    assert.ok(looksLikeOk(getResultText(parsed)))
  } finally {
    upstream.stop(true)
  }
}

async function testCustomOpenAIProviderWithTools(): Promise<void> {
  const requests: Array<Record<string, unknown>> = []
  const upstream = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    async fetch(request) {
      assert.equal(request.method, 'POST')
      assert.equal(new URL(request.url).pathname, '/chat/completions')
      const body = (await request.json()) as Record<string, unknown>
      requests.push(body)

      const messages = Array.isArray(body.messages)
        ? (body.messages as Array<Record<string, unknown>>)
        : []
      const sawToolResult = messages.some(message => message.role === 'tool')
      if (!sawToolResult) {
        const toolName =
          ((body.tools as Array<Record<string, unknown>> | undefined)?.[0] as
            | Record<string, unknown>
            | undefined)?.function &&
          typeof (
            ((body.tools as Array<Record<string, unknown>>)[0] as Record<
              string,
              unknown
            >).function as Record<string, unknown>
          ).name === 'string'
            ? String(
                (
                  ((body.tools as Array<Record<string, unknown>>)[0] as Record<
                    string,
                    unknown
                  >).function as Record<string, unknown>
                ).name,
              )
            : 'Bash'

        return Response.json({
          id: 'chatcmpl_mock_tool',
          object: 'chat.completion',
          model: 'mock-openai-upstream',
          choices: [
            {
              index: 0,
              finish_reason: 'tool_calls',
              message: {
                content: null,
                tool_calls: [
                  {
                    id: 'call_mock_bash',
                    type: 'function',
                    function: {
                      name: toolName,
                      arguments: JSON.stringify({ command: 'printf ok' }),
                    },
                  },
                ],
              },
            },
          ],
          usage: {
            prompt_tokens: 1,
            completion_tokens: 1,
          },
        })
      }

      return Response.json({
        id: 'chatcmpl_mock_final',
        object: 'chat.completion',
        model: 'mock-openai-upstream',
        choices: [
          {
            index: 0,
            finish_reason: 'stop',
            message: {
              content: 'ok',
            },
          },
        ],
        usage: {
          prompt_tokens: 1,
          completion_tokens: 1,
        },
      })
    },
  })

  try {
    const settings = JSON.stringify({
      gatewayProviders: {
        mockopenai: {
          type: 'openai-chat',
          name: 'Mock OpenAI',
          baseURL: `http://${upstream.hostname}:${upstream.port}`,
          apiKey: 'mock-key',
          enableStreaming: false,
        },
      },
      gatewayModels: [
        {
          id: 'mock-openai',
          name: 'Mock OpenAI Model',
          provider: 'mockopenai',
          model: 'mock-openai-upstream',
          free: true,
          enableStreaming: false,
        },
      ],
    })

    const { parsed } = await runCli([
      '--bare',
      '-p',
      '--output-format',
      'json',
      '--settings',
      settings,
      '--allowedTools',
      'Bash(printf ok)',
      '--model',
      'ext:custom:mock-openai',
      'Use the Bash tool to run: printf ok. Then answer with exactly the tool output.',
    ])

    assert.ok(looksLikeOk(getResultText(parsed)))
    assert.ok(requests.length >= 2, 'Expected tool-calling flow to make multiple upstream requests')
    assert.ok(
      requests.some(request => Array.isArray(request.tools) && request.tools.length > 0),
      'Expected tool schemas in OpenAI-compatible upstream request',
    )
    assert.ok(
      requests.some(request =>
        Array.isArray(request.messages) &&
        request.messages.some(
          (message: unknown) =>
            !!message &&
            typeof message === 'object' &&
            (message as Record<string, unknown>).role === 'tool',
        ),
      ),
      'Expected tool result message in OpenAI-compatible follow-up request',
    )
  } finally {
    upstream.stop(true)
  }
}

async function testCustomOpenAIProviderStreamingWithTools(): Promise<void> {
  const requests: Array<Record<string, unknown>> = []
  const upstream = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    async fetch(request) {
      assert.equal(request.method, 'POST')
      assert.equal(new URL(request.url).pathname, '/chat/completions')
      const body = (await request.json()) as Record<string, unknown>
      requests.push(body)
      assert.equal(body.stream, true)

      const messages = Array.isArray(body.messages)
        ? (body.messages as Array<Record<string, unknown>>)
        : []
      const sawToolResult = messages.some(message => message.role === 'tool')

      const stream = new ReadableStream({
        start(controller) {
          const encoder = new TextEncoder()
          const chunks = sawToolResult
            ? [
                {
                  choices: [
                    {
                      delta: {
                        content: 'ok',
                      },
                      finish_reason: null,
                    },
                  ],
                },
                {
                  choices: [
                    {
                      delta: {},
                      finish_reason: 'stop',
                    },
                  ],
                  usage: {
                    prompt_tokens: 1,
                    completion_tokens: 1,
                  },
                },
              ]
            : [
                {
                  choices: [
                    {
                      delta: {
                        tool_calls: [
                          {
                            index: 0,
                            id: 'call_stream_bash',
                            type: 'function',
                            function: {
                              name: 'Bash',
                              arguments: JSON.stringify({ command: 'printf ok' }),
                            },
                          },
                        ],
                      },
                      finish_reason: null,
                    },
                  ],
                },
                {
                  choices: [
                    {
                      delta: {},
                      finish_reason: 'tool_calls',
                    },
                  ],
                  usage: {
                    prompt_tokens: 1,
                    completion_tokens: 1,
                  },
                },
              ]

          for (const chunk of chunks) {
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`),
            )
          }
          controller.enqueue(encoder.encode('data: [DONE]\n\n'))
          controller.close()
        },
      })

      return new Response(stream, {
        status: 200,
        headers: {
          'content-type': 'text/event-stream',
          'cache-control': 'no-cache',
          connection: 'keep-alive',
        },
      })
    },
  })

  try {
    const settings = JSON.stringify({
      gatewayProviders: {
        mockopenaistream: {
          type: 'openai-chat',
          name: 'Mock OpenAI Streaming',
          baseURL: `http://${upstream.hostname}:${upstream.port}`,
          apiKey: 'mock-key',
          enableStreaming: true,
        },
      },
      gatewayModels: [
        {
          id: 'mock-openai-stream',
          name: 'Mock OpenAI Stream Model',
          provider: 'mockopenaistream',
          model: 'mock-openai-stream-upstream',
          free: true,
          enableStreaming: true,
        },
      ],
    })

    const { parsed, stdout } = await runCli([
      '--bare',
      '-p',
      '--verbose',
      '--output-format',
      'stream-json',
      '--include-partial-messages',
      '--settings',
      settings,
      '--allowedTools',
      'Bash(printf ok)',
      '--model',
      'ext:custom:mock-openai-stream',
      'Use the Bash tool to run: printf ok. Then answer with exactly the tool output.',
    ])

    assert.equal(parsed.type, 'result')
    assert.ok(typeof parsed.result === 'string' && looksLikeOk(parsed.result))
    assert.ok(
      stdout.includes('"type":"stream_event"'),
      `Expected streaming events in output.\n${stdout}`,
    )
    assert.ok(requests.length >= 2, 'Expected streaming tool-calling flow to make multiple upstream requests')
    assert.ok(
      requests.some(request =>
        Array.isArray(request.messages) &&
        request.messages.some(
          (message: unknown) =>
            !!message &&
            typeof message === 'object' &&
            (message as Record<string, unknown>).role === 'tool',
        ),
      ),
      'Expected tool result message in streaming OpenAI-compatible follow-up request',
    )
  } finally {
    upstream.stop(true)
  }
}

function testToolSchemaNormalization(): void {
  const normalized = normalizeToolSchema({
    anyOf: [
      {
        type: 'object',
        properties: {
          query: {
            type: ['string', 'null'],
            format: 'uri',
          },
        },
        required: ['query', 'missing'],
      },
      { type: 'null' },
    ],
  }) as Record<string, unknown>

  assert.equal(normalized.type, 'object')
  assert.deepEqual(normalized.required, ['query'])
  assert.equal(normalized.additionalProperties, false)
  const properties = normalized.properties as Record<string, Record<string, unknown>>
  assert.ok(properties.query, 'Expected normalized object property')
  assert.deepEqual(properties.query.anyOf, [{ type: 'string' }, { type: 'null' }])
  assert.equal(properties.query.format, undefined)
}

async function testCustomAnthropicProviderStreaming(): Promise<void> {
  const requests: Array<{
    body: Record<string, unknown>
    headers: Headers
  }> = []
  const upstream = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    async fetch(request) {
      assert.equal(request.method, 'POST')
      assert.equal(new URL(request.url).pathname, '/messages')
      const body = (await request.json()) as Record<string, unknown>
      requests.push({
        body,
        headers: request.headers,
      })

      assert.equal(body.model, 'mock-streaming-upstream')
      assert.equal(body.stream, true)
      assert.equal(body.temperature, 0.25)
      assert.equal(body.gateway_marker, 'provider')
      assert.equal(body.model_marker, 'model')

      const stream = new ReadableStream({
        start(controller) {
          const encoder = new TextEncoder()
          const events = [
            {
              event: 'message_start',
              data: {
                type: 'message_start',
                message: {
                  id: 'msg_stream',
                  type: 'message',
                  role: 'assistant',
                  model: 'mock-streaming-upstream',
                  content: [],
                  stop_reason: null,
                  stop_sequence: null,
                  usage: {
                    input_tokens: 1,
                    output_tokens: 0,
                  },
                },
              },
            },
            {
              event: 'content_block_start',
              data: {
                type: 'content_block_start',
                index: 0,
                content_block: {
                  type: 'text',
                  text: '',
                },
              },
            },
            {
              event: 'content_block_delta',
              data: {
                type: 'content_block_delta',
                index: 0,
                delta: {
                  type: 'text_delta',
                  text: 'ok',
                },
              },
            },
            {
              event: 'content_block_stop',
              data: {
                type: 'content_block_stop',
                index: 0,
              },
            },
            {
              event: 'message_delta',
              data: {
                type: 'message_delta',
                delta: {
                  stop_reason: 'end_turn',
                  stop_sequence: null,
                },
                usage: {
                  input_tokens: 1,
                  output_tokens: 1,
                },
              },
            },
            {
              event: 'message_stop',
              data: {
                type: 'message_stop',
              },
            },
          ]

          for (const part of events) {
            controller.enqueue(
              encoder.encode(
                `event: ${part.event}\ndata: ${JSON.stringify(part.data)}\n\n`,
              ),
            )
          }
          controller.close()
        },
      })

      return new Response(stream, {
        status: 200,
        headers: {
          'content-type': 'text/event-stream',
          'cache-control': 'no-cache',
          connection: 'keep-alive',
        },
      })
    },
  })

  try {
    const settings = JSON.stringify({
      gatewayProviders: {
        mockstream: {
          type: 'anthropic',
          name: 'Mock Streaming',
          baseURL: `http://${upstream.hostname}:${upstream.port}`,
          apiKey: 'mock-key',
          headers: {
            'x-provider-header': 'provider',
          },
          body: {
            gateway_marker: 'provider',
          },
          enableStreaming: true,
        },
      },
      gatewayModels: [
        {
          id: 'mock-streaming',
          name: 'Mock Streaming Model',
          provider: 'mockstream',
          model: 'mock-streaming-upstream',
          temperature: 0.25,
          enableStreaming: true,
          headers: {
            'x-model-header': 'model',
          },
          body: {
            model_marker: 'model',
          },
        },
      ],
    })

    const { parsed, stdout } = await runCli([
      '--bare',
      '-p',
      '--verbose',
      '--output-format',
      'stream-json',
      '--include-partial-messages',
      '--settings',
      settings,
      '--model',
      'ext:custom:mock-streaming',
      'Reply with exactly: ok',
    ])

    assert.equal(parsed.type, 'result')
    assert.ok(typeof parsed.result === 'string' && looksLikeOk(parsed.result))
    assert.ok(
      stdout.includes('"type":"stream_event"'),
      `Expected streaming events in output.\n${stdout}`,
    )
    assert.ok(requests.length > 0, 'Expected streaming upstream request')
    assert.equal(requests[0]?.headers.get('x-provider-header'), 'provider')
    assert.equal(requests[0]?.headers.get('x-model-header'), 'model')
  } finally {
    upstream.stop(true)
  }
}

async function testBuiltCliWithLiveFreeModels(): Promise<void> {
  const kilo = await runCli([
    '--bare',
    '-p',
    '--output-format',
    'json',
    '--model',
    'ext:kilo:kilo-auto/free',
    'Reply with exactly: ok',
  ])
  assert.ok(looksLikeOk(getResultText(kilo.parsed)))

  const openCodeCandidates = getGatewayModelOptions()
    .filter(option => option.source === 'opencode' && option.isFree)
    .map(option => option.value)
  assert.ok(openCodeCandidates.length > 0, 'Expected at least one free OpenCode model')

  let openCodeSucceeded = false
  const failures: string[] = []
  for (const model of openCodeCandidates) {
    try {
      const openCode = await runCli([
        '--bare',
        '-p',
        '--output-format',
        'json',
        '--model',
        model,
        'Reply with exactly: ok',
      ])
      assert.ok(looksLikeOk(getResultText(openCode.parsed)))
      openCodeSucceeded = true
      break
    } catch (error) {
      failures.push(`${model}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  assert.ok(
    openCodeSucceeded,
    `No OpenCode free model passed the CLI smoke test.\n${failures.join('\n')}`,
  )
}

async function main(): Promise<void> {
  console.log('Refreshing live gateway catalog...')
  await testLiveGatewayCatalog()

  console.log('Testing direct live gateway requests...')
  await testLiveGatewayRequests()

  console.log('Testing custom Anthropic-compatible provider...')
  await testCustomAnthropicProvider()

  console.log('Testing custom OpenAI-compatible provider with tool calls...')
  await testCustomOpenAIProviderWithTools()

  console.log('Testing custom OpenAI-compatible provider streaming with tool calls...')
  await testCustomOpenAIProviderStreamingWithTools()

  console.log('Testing custom Anthropic-compatible provider streaming...')
  await testCustomAnthropicProviderStreaming()

  console.log('Testing tool schema normalization...')
  testToolSchemaNormalization()

  console.log('Testing built CLI against live free models...')
  await testBuiltCliWithLiveFreeModels()

  console.log('Model gateway smoke tests passed.')
}

await main()
