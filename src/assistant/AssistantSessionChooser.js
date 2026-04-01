import React from 'react'

export function AssistantSessionChooser({ sessions, onSelect, onCancel }) {
  React.useEffect(() => {
    onSelect?.(sessions?.[0]?.id ?? null)
  }, [onSelect, sessions])
  return null
}

export default AssistantSessionChooser
