// @vitest-environment node
import { describe, expect, it } from 'vitest'
import type { StartupStatus } from '@shared'
import { shouldRunReleaseAgentSmoke } from './startup-smoke'

describe('release Agent smoke startup gate', () => {
  it('runs only for a normal startup status', () => {
    const normal: StartupStatus = { mode: 'normal' }
    const recovery: StartupStatus = {
      mode: 'recovery-required',
      reason: 'local-storage-unavailable',
      activeDataPreserved: true,
      networkAccess: false,
      message: 'ローカルデータを開けません。'
    }

    expect(shouldRunReleaseAgentSmoke(normal)).toBe(true)
    expect(shouldRunReleaseAgentSmoke(recovery)).toBe(false)
  })
})
