import type { StartupStatus } from '@shared'

export function shouldRunReleaseAgentSmoke(status: StartupStatus): boolean {
  return status.mode === 'normal'
}
