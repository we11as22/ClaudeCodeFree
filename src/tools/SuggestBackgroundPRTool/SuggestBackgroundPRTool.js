import { z } from 'zod'

export const SuggestBackgroundPRTool = {
  name: 'SuggestBackgroundPRTool',
  description: 'Unavailable in this build',
  inputSchema: z.object({}).passthrough(),
  isReadOnly: () => true,
  isConcurrencySafe: true,
  needsPermissions: () => false,
  async prompt() {
    return 'Unavailable in this build'
  },
  async call() {
    return {
      content: [
        { type: 'text', text: 'SuggestBackgroundPRTool is unavailable in this build.' },
      ],
    }
  },
}
