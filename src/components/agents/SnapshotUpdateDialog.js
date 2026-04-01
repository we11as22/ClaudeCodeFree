import React from 'react'

export function SnapshotUpdateDialog({ onComplete, onCancel }) {
  React.useEffect(() => {
    onComplete?.('keep')
  }, [onComplete])
  return null
}

export default SnapshotUpdateDialog
