export function isConnectorTextBlock(block) {
  return Boolean(block && typeof block === 'object' && block.type === 'connector_text')
}
