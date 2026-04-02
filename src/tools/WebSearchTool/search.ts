import axios from 'axios'
import { getWebFetchUserAgent } from '../../utils/http.js'
import { isEnvTruthy } from '../../utils/envUtils.js'
import { getInitialSettings } from '../../utils/settings/settings.js'
import type { ToolUseContext } from '../../Tool.js'
import type { WebSearchProgress } from '../../types/tools.js'
import { searchViaExaMcp } from './exaSearch.js'
import {
  canAttemptAnthropicServerWebSearch,
  tryAnthropicServerWebSearch,
} from './nativeWebSearch.js'
import type { SearchHit } from './searchTypes.js'

export type { SearchHit } from './searchTypes.js'

const SEARCH_TIMEOUT_MS = 20_000
const MAX_RESULTS = 8
const SEARXNG_TIMEOUT_MS = 30_000
const SITE_OPERATOR_REGEX = /(?:^|\s)site:([^\s]+)/gi
const AUTO_SEARXNG_CANDIDATES = [
  'http://127.0.0.1:8080',
  'http://localhost:8080',
  'http://127.0.0.1:8081',
  'http://localhost:8081',
]

let autoDetectedSearXNGURL: string | null | undefined

type SearXNGConfig = {
  provider: 'direct' | 'searxng'
  instanceURL?: string
  apiKey?: string
  maxResults: number
  language?: string
  categories?: string
  engines?: string
  safesearch?: number
  timeoutMs: number
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
}

function stripTags(value: string): string {
  return decodeHtmlEntities(value.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim())
}

function normalizeHref(rawHref: string): string | null {
  const href = decodeHtmlEntities(rawHref.trim())
  try {
    if (href.startsWith('//duckduckgo.com/l/?')) {
      const parsed = new URL(`https:${href}`)
      const uddg = parsed.searchParams.get('uddg')
      return uddg ? decodeURIComponent(uddg) : null
    }
    if (href.startsWith('//')) {
      return `https:${href}`
    }
    if (href.startsWith('https://duckduckgo.com/l/?')) {
      const parsed = new URL(href)
      const uddg = parsed.searchParams.get('uddg')
      return uddg ? decodeURIComponent(uddg) : null
    }
    if (href.startsWith('http://duckduckgo.com/l/?')) {
      const parsed = new URL(href)
      const uddg = parsed.searchParams.get('uddg')
      return uddg ? decodeURIComponent(uddg) : null
    }
    if (href.startsWith('/l/?')) {
      const parsed = new URL(`https://duckduckgo.com${href}`)
      const uddg = parsed.searchParams.get('uddg')
      return uddg ? decodeURIComponent(uddg) : null
    }
    if (href.startsWith('http://') || href.startsWith('https://')) {
      return href
    }
    return null
  } catch {
    return null
  }
}

function isAllowedUrl(
  url: string,
  allowedDomains?: string[],
  blockedDomains?: string[],
): boolean {
  try {
    const hostname = new URL(url).hostname.toLowerCase()
    if (
      allowedDomains &&
      allowedDomains.length > 0 &&
      !allowedDomains.some(domain => hostname === domain || hostname.endsWith(`.${domain}`))
    ) {
      return false
    }
    if (
      blockedDomains &&
      blockedDomains.some(domain => hostname === domain || hostname.endsWith(`.${domain}`))
    ) {
      return false
    }
    return true
  } catch {
    return false
  }
}

function buildSearchQuery(query: string, allowedDomains?: string[]): string {
  if (!allowedDomains || allowedDomains.length === 0) {
    return query
  }
  const siteQuery = allowedDomains.map(domain => `site:${domain}`).join(' OR ')
  return `${query} (${siteQuery})`
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.map(value => value.trim()).filter(Boolean)))
}

function extractSiteOperators(query: string): {
  normalizedQuery: string
  siteDomains: string[]
} {
  const siteDomains = Array.from(
    query.matchAll(SITE_OPERATOR_REGEX),
    match => (match[1] ?? '').trim().toLowerCase(),
  ).filter(Boolean)

  const normalizedQuery = query.replace(SITE_OPERATOR_REGEX, ' ').replace(/\s+/g, ' ').trim()
  return {
    normalizedQuery,
    siteDomains,
  }
}

function splitList(value?: string): string[] {
  return (value ?? '')
    .split(',')
    .map(item => item.trim())
    .filter(Boolean)
}

function containsCyrillic(text: string): boolean {
  return /[\u0400-\u04FF]/u.test(text)
}

function getWebSearchConfig(): SearXNGConfig {
  const settings = getInitialSettings()
  const webSearchSettings = settings.webSearch
  const searxngSettings = webSearchSettings?.searxng
  const provider =
    (process.env.SEARCH_PROVIDER as 'direct' | 'searxng' | undefined) ??
    webSearchSettings?.provider ??
    (process.env.SEARXNG_INSTANCE_URL || searxngSettings?.instanceURL
      ? 'searxng'
      : 'direct')

  return {
    provider,
    instanceURL:
      process.env.SEARXNG_INSTANCE_URL ?? searxngSettings?.instanceURL,
    apiKey: process.env.SEARXNG_API_KEY ?? searxngSettings?.apiKey,
    maxResults: Math.max(
      1,
      parseInt(
        process.env.SEARXNG_MAX_RESULTS ??
          String(searxngSettings?.maxResults ?? MAX_RESULTS),
        10,
      ) || MAX_RESULTS,
    ),
    language: process.env.SEARXNG_LANGUAGE ?? searxngSettings?.language,
    categories: process.env.SEARXNG_CATEGORIES ?? searxngSettings?.categories,
    engines: process.env.SEARXNG_ENGINES ?? searxngSettings?.engines,
    safesearch: parseInt(
      process.env.SEARXNG_SAFESEARCH ??
        String(searxngSettings?.safesearch ?? 0),
      10,
    ),
    timeoutMs: Math.max(
      1,
      parseInt(
        process.env.SEARXNG_TIMEOUT_MS ??
          String(searxngSettings?.timeoutMs ?? SEARXNG_TIMEOUT_MS),
        10,
      ) || SEARXNG_TIMEOUT_MS,
    ),
  }
}

async function detectLocalSearXNGURL(): Promise<string | null> {
  if (autoDetectedSearXNGURL !== undefined) {
    return autoDetectedSearXNGURL
  }

  for (const candidate of AUTO_SEARXNG_CANDIDATES) {
    try {
      const response = await axios.get(`${candidate}/search`, {
        params: { q: 'test', format: 'json' },
        timeout: 1500,
        responseType: 'json',
        headers: {
          Accept: 'application/json',
          'User-Agent': getWebFetchUserAgent(),
        },
      })
      if (response.status === 200 && Array.isArray(response.data?.results)) {
        autoDetectedSearXNGURL = candidate
        return candidate
      }
    } catch {
      // Try the next candidate.
    }
  }

  autoDetectedSearXNGURL = null
  return null
}

function getSearXNGParams(
  query: string,
  config: SearXNGConfig,
): Record<string, string | number> {
  const params: Record<string, string | number> = {
    q: query.trim(),
    format: 'json',
  }

  if (containsCyrillic(query)) {
    params.language = 'ru'
  } else if (config.language && config.language !== 'auto') {
    params.language = config.language
  }

  if (config.safesearch && config.safesearch !== 0) {
    params.safesearch = config.safesearch
  }

  const categories = splitList(config.categories)
  if (categories.length > 0) {
    params.categories = categories.join(',')
  }

  const engines = splitList(config.engines).filter(
    engine => !['bing', 'yahoo'].includes(engine.toLowerCase()),
  )
  if (engines.length > 0) {
    params.engines = engines.join(',')
  }

  return params
}

async function searchViaDirectBackend(
  query: string,
  allowedDomains?: string[],
  blockedDomains?: string[],
): Promise<SearchHit[]> {
  const { normalizedQuery, siteDomains } = extractSiteOperators(query)
  const effectiveAllowedDomains = Array.from(
    new Set([...(allowedDomains ?? []), ...siteDomains]),
  )
  const effectiveQuery = normalizedQuery.length > 0 ? normalizedQuery : query
  const results: SearchHit[] = []
  const seen = new Set<string>()
  const queryTokens = effectiveQuery
    .split(/\s+/)
    .map(token => token.trim())
    .filter(token => token.length >= 3)
  const retryQueries = uniqueStrings([
    buildSearchQuery(effectiveQuery, effectiveAllowedDomains),
    effectiveAllowedDomains.length > 0
      ? `${effectiveQuery} ${effectiveAllowedDomains.join(' ')}`
      : '',
    queryTokens.length > 3
      ? buildSearchQuery(
          queryTokens.slice(0, 3).join(' '),
          effectiveAllowedDomains,
        )
      : '',
    effectiveAllowedDomains.length > 0 && queryTokens.length > 3
      ? `${queryTokens.slice(0, 3).join(' ')} ${effectiveAllowedDomains.join(' ')}`
      : '',
  ])

  for (const retryQuery of retryQueries) {
    const response = await axios.get('https://html.duckduckgo.com/html/', {
      params: {
        q: retryQuery,
        kl: 'us-en',
      },
      timeout: SEARCH_TIMEOUT_MS,
      responseType: 'text',
      headers: {
        Accept: 'text/html,application/xhtml+xml',
        'User-Agent': getWebFetchUserAgent(),
      },
    })

    const html = String(response.data ?? '')
    const matches = html.matchAll(
      /<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi,
    )

    for (const match of matches) {
      const url = normalizeHref(match[1] ?? '')
      const title = stripTags(match[2] ?? '')
      if (!url || !title || seen.has(url)) {
        continue
      }
      if (!isAllowedUrl(url, effectiveAllowedDomains, blockedDomains)) {
        continue
      }
      seen.add(url)
      results.push({ title, url })
      if (results.length >= MAX_RESULTS) {
        return results
      }
    }
  }

  return results
}

async function searchViaSearXNG(
  query: string,
  allowedDomains?: string[],
  blockedDomains?: string[],
): Promise<SearchHit[]> {
  const config = getWebSearchConfig()
  if (!config.instanceURL) {
    throw new Error('SearXNG instance URL is not configured')
  }

  const response = await axios.get(`${config.instanceURL.replace(/\/+$/, '')}/search`, {
    params: getSearXNGParams(buildSearchQuery(query, allowedDomains), config),
    timeout: config.timeoutMs,
    responseType: 'json',
    headers: {
      Accept: 'application/json',
      'User-Agent': getWebFetchUserAgent(),
      ...(config.apiKey
        ? {
            Authorization: `Bearer ${config.apiKey}`,
            'X-API-Key': config.apiKey,
          }
        : {}),
    },
  })

  const rawResults = Array.isArray(response.data?.results)
    ? response.data.results
    : []
  const results: SearchHit[] = []
  const seen = new Set<string>()

  for (const item of rawResults) {
    const url = typeof item?.url === 'string' ? item.url : ''
    if (!url || seen.has(url)) {
      continue
    }
    if (!isAllowedUrl(url, allowedDomains, blockedDomains)) {
      continue
    }

    const title =
      typeof item?.title === 'string' && item.title.trim().length > 0
        ? item.title.trim()
        : url
    const snippetSource =
      typeof item?.content === 'string' && item.content.trim().length > 0
        ? item.content
        : typeof item?.snippet === 'string'
          ? item.snippet
          : title

    seen.add(url)
    results.push({
      title,
      url,
      snippet: snippetSource.trim(),
      score:
        typeof item?.score === 'number' && Number.isFinite(item.score)
          ? item.score
          : undefined,
      published_date:
        typeof item?.publishedDate === 'string'
          ? item.publishedDate
          : typeof item?.published_date === 'string'
            ? item.published_date
            : undefined,
      engine: typeof item?.engine === 'string' ? item.engine : undefined,
    })
    if (results.length >= config.maxResults) {
      break
    }
  }

  return results
}

export async function searchWeb(
  query: string,
  allowedDomains?: string[],
  blockedDomains?: string[],
): Promise<SearchHit[]> {
  const config = getWebSearchConfig()
  if (
    config.provider === 'direct' &&
    !config.instanceURL &&
    !process.env.SEARCH_PROVIDER
  ) {
    const autoDetectedURL = await detectLocalSearXNGURL()
    if (autoDetectedURL) {
      config.provider = 'searxng'
      config.instanceURL = autoDetectedURL
    }
  }
  if (config.provider === 'searxng') {
    try {
      return await searchViaSearXNG(query, allowedDomains, blockedDomains)
    } catch {
      return searchViaDirectBackend(query, allowedDomains, blockedDomains)
    }
  }
  return searchViaDirectBackend(query, allowedDomains, blockedDomains)
}

function getWebSearchCascadeMode(): 'auto' | 'local' {
  const env = process.env.WEB_SEARCH_MODE?.trim().toLowerCase()
  if (env === 'local') {
    return 'local'
  }
  const mode = getInitialSettings().webSearch?.mode
  if (mode === 'local') {
    return 'local'
  }
  return 'auto'
}

/**
 * Resolution order when mode is `auto` (default) — OpenClaude first, opencode-style Exa second:
 * 1. Anthropic server `web_search` (OpenClaude-style) when supported and not skipped
 * 2. Exa MCP (`mcp.exa.ai`) — opencode-style fallback when step 1 yields nothing or errors
 * 3. Local SearXNG / DuckDuckGo when neither produced usable hits
 *
 * Override with `WEB_SEARCH_MODE=local` or `settings.webSearch.mode: "local"` for local-only.
 * `WEB_SEARCH_SKIP_NATIVE=1` / `WEB_SEARCH_SKIP_EXA=1` disable individual steps.
 */
export async function searchWebWithCascade(
  query: string,
  allowedDomains: string[] | undefined,
  blockedDomains: string[] | undefined,
  context: ToolUseContext,
  onProgress?: (data: WebSearchProgress) => void,
): Promise<SearchHit[]> {
  if (getWebSearchCascadeMode() === 'local') {
    return searchWeb(query, allowedDomains, blockedDomains)
  }

  const skipNative = isEnvTruthy(process.env.WEB_SEARCH_SKIP_NATIVE)
  const skipExa = isEnvTruthy(process.env.WEB_SEARCH_SKIP_EXA)

  if (!skipNative && canAttemptAnthropicServerWebSearch()) {
    try {
      const hits = await tryAnthropicServerWebSearch(
        {
          query,
          allowed_domains: allowedDomains,
          blocked_domains: blockedDomains,
        },
        context,
        onProgress,
      )
      if (hits.length > 0) {
        return hits
      }
    } catch {
      // Continue to Exa / local.
    }
  }

  if (!skipExa) {
    try {
      const hits = await searchViaExaMcp(
        query,
        context.abortController.signal,
      )
      if (hits.length > 0) {
        return hits
      }
    } catch {
      // Continue to local search.
    }
  }

  return searchWeb(query, allowedDomains, blockedDomains)
}
