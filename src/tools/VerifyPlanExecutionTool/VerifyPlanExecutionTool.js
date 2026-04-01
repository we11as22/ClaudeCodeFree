import { z } from 'zod'

export const VerifyPlanExecutionTool = {
  name: 'VerifyPlanExecutionTool',
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
        { type: 'text', text: 'VerifyPlanExecutionTool is unavailable in this build.' },
      ],
    }
  },
}
