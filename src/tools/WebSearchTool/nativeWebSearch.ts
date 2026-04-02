import type { BetaContentBlock } from '@anthropic-ai/sdk/resources/beta/messages/messages.mjs'
import type { BetaWebSearchTool20250305 } from '@anthropic-ai/sdk/resources/beta/messages/messages.mjs'
import { queryModelWithStreaming } from '../../services/api/claude.js'
import type { ToolUseContext } from '../../Tool.js'
import { getAPIProvider } from '../../utils/model/providers.js'
import {
  getCanonicalName,
  getMainLoopModel,
  getSmallFastModel,
} from '../../utils/model/model.js'
import { createUserMessage } from '../../utils/messages.js'
import { asSystemPrompt } from '../../utils/systemPromptType.js'
import { jsonParse } from '../../utils/slowOperations.js'
import type { Options } from '../../services/api/claude.js'
import type { WebSearchProgress } from '../../types/tools.js'
import type { SearchHit } from './searchTypes.js'

function vertexModelSupportsWebSearch(model: string): boolean {
  const canonical = getCanonicalName(model)
  return (
    canonical.includes('claude-opus-4') ||
    canonical.includes('claude-sonnet-4') ||
    canonical.includes('claude-haiku-4')
  )
}

/**
 * True when Anthropic's server-side web_search tool may be available (API still may reject).
 */
export function canAttemptAnthropicServerWebSearch(): boolean {
  const provider = getAPIProvider()
  if (provider === 'bedrock') {
    return false
  }
  if (provider === 'vertex') {
    return vertexModelSupportsWebSearch(getMainLoopModel())
  }
  return provider === 'firstParty' || provider === 'foundry'
}

function makeToolSchema(input: {
  allowed_domains?: string[]
  blocked_domains?: string[]
}): BetaWebSearchTool20250305 {
  return {
    type: 'web_search_20250305',
    name: 'web_search',
    allowed_domains: input.allowed_domains,
    blocked_domains: input.blocked_domains,
    max_uses: 8,
  }
}

function blocksToSearchHits(blocks: BetaContentBlock[]): SearchHit[] {
  const hits: SearchHit[] = []
  for (const block of blocks) {
    if (block.type !== 'web_search_tool_result') {
      continue
    }
    if (!Array.isArray(block.content)) {
      continue
    }
    for (const r of block.content) {
      if (
        r &&
        typeof (r as { title?: string }).title === 'string' &&
        typeof (r as { url?: string }).url === 'string'
      ) {
        hits.push({
          title: (r as { title: string }).title,
          url: (r as { url: string }).url,
        })
      }
    }
  }
  return hits
}

/**
 * One round-trip to the Messages API with the web_search server tool; returns hits or throws.
 */
export async function tryAnthropicServerWebSearch(
  input: {
    query: string
    allowed_domains?: string[]
    blocked_domains?: string[]
  },
  context: ToolUseContext,
  onProgress?: (data: WebSearchProgress) => void,
): Promise<SearchHit[]> {
  const userMessage = createUserMessage({
    content: 'Perform a web search for the query: ' + input.query,
  })
  const toolSchema = makeToolSchema(input)
  const appState = context.getAppState()

  const queryStream = queryModelWithStreaming({
    messages: [userMessage],
    systemPrompt: asSystemPrompt([
      'You are an assistant for performing a web search tool use',
    ]),
    thinkingConfig: { type: 'disabled' },
    tools: [],
    signal: context.abortController.signal,
    options: {
      getToolPermissionContext: async () => appState.toolPermissionContext,
      model: getSmallFastModel(),
      toolChoice: { type: 'tool', name: 'web_search' },
      isNonInteractiveSession: context.options.isNonInteractiveSession,
      hasAppendSystemPrompt: !!context.options.appendSystemPrompt,
      extraToolSchemas: [toolSchema],
      querySource: 'web_search_native' as unknown as Options['querySource'],
      agents: context.options.agentDefinitions.activeAgents,
      mcpTools: [],
      agentId: context.agentId,
      effortValue: appState.effortValue,
    },
  })

  const allContentBlocks: BetaContentBlock[] = []
  let currentToolUseId: string | null = null
  let currentToolUseJson = ''
  const toolUseQueries = new Map<string, string>()

  for await (const event of queryStream) {
    if (event.type === 'assistant') {
      allContentBlocks.push(...event.message.content)
      continue
    }

    if (
      event.type === 'stream_event' &&
      event.event?.type === 'content_block_start'
    ) {
      const contentBlock = event.event.content_block
      if (contentBlock && contentBlock.type === 'server_tool_use') {
        currentToolUseId = contentBlock.id
        currentToolUseJson = ''
        continue
      }
      if (contentBlock && contentBlock.type === 'web_search_tool_result') {
        const toolUseId = contentBlock.tool_use_id
        const actualQuery = toolUseQueries.get(toolUseId ?? '') || input.query
        const content = contentBlock.content
        onProgress?.({
          type: 'search_results_received',
          resultCount: Array.isArray(content) ? content.length : 0,
          query: actualQuery,
        })
      }
    }

    if (
      currentToolUseId &&
      event.type === 'stream_event' &&
      event.event?.type === 'content_block_delta'
    ) {
      const delta = event.event.delta
      if (delta?.type === 'input_json_delta' && delta.partial_json) {
        currentToolUseJson += delta.partial_json
        try {
          const queryMatch = currentToolUseJson.match(
            /"query"\s*:\s*"((?:[^"\\]|\\.)*)"/,
          )
          if (queryMatch?.[1]) {
            const q = jsonParse('"' + queryMatch[1] + '"') as string
            if (
              !toolUseQueries.has(currentToolUseId) ||
              toolUseQueries.get(currentToolUseId) !== q
            ) {
              toolUseQueries.set(currentToolUseId, q)
              onProgress?.({ type: 'query_update', query: q })
            }
          }
        } catch {
          // partial JSON
        }
      }
    }
  }

  return blocksToSearchHits(allContentBlocks)
}
