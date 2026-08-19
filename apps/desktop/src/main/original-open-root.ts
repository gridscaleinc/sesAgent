import { mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * Private temporary directory that decrypted original documents are
 * materialized into before being handed to the OS default application.
 */
let originalOpenRootPath: string | null = null

export async function prepareOriginalOpenRoot(userDataPath: string): Promise<string> {
  const root = join(userDataPath, 'temporary', 'original-open')
  await rm(root, { recursive: true, force: true })
  await mkdir(root, { recursive: true, mode: 0o700 })
  originalOpenRootPath = root
  return root
}

export function currentOriginalOpenRoot(): string | null {
  return originalOpenRootPath
}

/** Fire-and-forget removal used on quit, where awaiting is not an option. */
export function clearOriginalOpenRoot(): void {
  if (originalOpenRootPath) void rm(originalOpenRootPath, { recursive: true, force: true })
  originalOpenRootPath = null
}
