/**
 * Exa MCP HTTP search (same protocol as opencode's websearch tool).
 * No API key in the client — availability depends on Exa's policy for this endpoint.
 */

import type { SearchHit } from './searchTypes.js'

const EXA_MCP_URL = 'https://mcp.exa.ai/mcp'
const EXA_TIMEOUT_MS = 25_000

type McpSearchResponse = {
  jsonrpc?: string
  error?: { message?: string; code?: unknown }
  result?: {
    content?: Array<{ type?: string; text?: string }>
  }
}

function extractUrlsFromText(text: string, limit: number): SearchHit[] {
  const re = /https?:\/\/[^\s\])"'<>]+/g
  const seen = new Set<string>()
  const hits: SearchHit[] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    const url = m[0].replace(/[.,;:)]+$/, '')
    if (seen.has(url) || hits.length >= limit) continue
    seen.add(url)
    hits.push({
      title: `Source ${hits.length + 1}`,
      url,
      snippet: text.slice(0, 2000).trim(),
    })
  }
  return hits
}

/** Markdown links: [title](url) */
function extractUrlsFromMarkdown(text: string, limit: number): SearchHit[] {
  const re = /\[([^\]]{1,500})\]\((https?:\/\/[^)\s]+)\)/g
  const seen = new Set<string>()
  const hits: SearchHit[] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    const title = (m[1] ?? '').trim() || 'Source'
    const url = (m[2] ?? '').replace(/[.,;:)]+$/, '')
    if (!url || seen.has(url) || hits.length >= limit) continue
    seen.add(url)
    hits.push({
      title: title.slice(0, 200),
      url,
      snippet: text.slice(0, 2000).trim(),
    })
  }
  return hits
}

function hitsFromExaText(
  trimmed: string,
  originalQuery: string,
  numResults: number,
): SearchHit[] {
  const fromMd = extractUrlsFromMarkdown(trimmed, numResults)
  if (fromMd.length > 0) {
    return fromMd
  }
  const fromUrls = extractUrlsFromText(trimmed, numResults)
  if (fromUrls.length > 0) {
    return fromUrls
  }
  return [
    {
      title: 'Web search summary (Exa)',
      url: `https://duckduckgo.com/?q=${encodeURIComponent(originalQuery)}`,
      snippet: trimmed.slice(0, 12_000),
    },
  ]
}

function parseSsePayloads(raw: string): McpSearchResponse[] {
  const parsed: McpSearchResponse[] = []
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed.toLowerCase().startsWith('data:')) {
      continue
    }
    const payload = trimmed.slice(5).trimStart()
    if (!payload || payload === '[DONE]') {
      continue
    }
    try {
      parsed.push(JSON.parse(payload) as McpSearchResponse)
    } catch {
      continue
    }
  }
  return parsed
}

/** Prefer the last SSE chunk that carries usable result text (stream may send multiple events). */
function pickExaResultText(chunks: McpSearchResponse[]): string | undefined {
  let best: string | undefined
  for (const data of chunks) {
    if (data.error) {
      continue
    }
    const t = data.result?.content?.[0]?.text
    if (typeof t === 'string' && t.trim().length > 0) {
      best = t.trim()
    }
  }
  return best
}

/**
 * @returns hits derived from Exa text + URL extraction, or empty if unusable.
 */
export async function searchViaExaMcp(
  query: string,
  signal: AbortSignal,
  options?: {
    numResults?: number
    livecrawl?: 'fallback' | 'preferred'
    type?: 'auto' | 'fast' | 'deep'
    contextMaxCharacters?: number
  },
): Promise<SearchHit[]> {
  const numResults = Math.min(Math.max(1, options?.numResults ?? 8), 16)

  const body = {
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: {
      name: 'web_search_exa',
      arguments: {
        query,
        type: options?.type ?? 'auto',
        numResults,
        livecrawl: options?.livecrawl ?? 'fallback',
        ...(options?.contextMaxCharacters != null
          ? { contextMaxCharacters: options.contextMaxCharacters }
          : {}),
      },
    },
  }

  const timeoutController = new AbortController()
  const t = setTimeout(() => timeoutController.abort(), EXA_TIMEOUT_MS)
  const merged = new AbortController()
  const abortMerged = (): void => merged.abort()
  if (signal.aborted || timeoutController.signal.aborted) {
    merged.abort()
  } else {
    signal.addEventListener('abort', abortMerged, { once: true })
    timeoutController.signal.addEventListener('abort', abortMerged, {
      once: true,
    })
  }

  try {
    const response = await fetch(EXA_MCP_URL, {
      method: 'POST',
      headers: {
        accept: 'application/json, text/event-stream, application/json',
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: merged.signal,
    })

    const ct = response.headers.get('content-type') ?? ''

    if (!response.ok) {
      return []
    }

    let responseText: string
    if (ct.includes('application/json')) {
      const json = (await response.json()) as McpSearchResponse
      const chunks = json && typeof json === 'object' ? [json] : []
      const text = pickExaResultText(chunks)
      if (!text) {
        return []
      }
      return hitsFromExaText(text, query, numResults)
    }

    responseText = await response.text()
    const chunks = parseSsePayloads(responseText)
    const text = pickExaResultText(chunks)
    if (!text) {
      return []
    }
    return hitsFromExaText(text, query, numResults)
  } finally {
    clearTimeout(t)
    signal.removeEventListener('abort', abortMerged)
    timeoutController.signal.removeEventListener('abort', abortMerged)
  }
}
