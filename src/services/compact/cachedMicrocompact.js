export function createCachedMCState() {
  return {
    pinnedBlocks: [],
    pendingBlocks: [],
  }
}

export function pinCacheEdits(state, block) {
  state.pinnedBlocks.push(block)
}

export function consumePendingCacheEdits(state) {
  const pending = [...(state.pendingBlocks ?? [])]
  state.pendingBlocks = []
  return pending
}

export function getPinnedCacheEdits(state) {
  return state.pinnedBlocks ?? []
}

export function cachedMicrocompactPath() {
  return null
}
