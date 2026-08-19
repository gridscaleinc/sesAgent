import { hkdfSync } from 'node:crypto'

export interface ApplicationKeys {
  databaseKey: Buffer
  mappingKey: Buffer
  fileVaultKey: Buffer
}

export interface ApplicationKeyMaterial extends ApplicationKeys {
  masterKey: Buffer
}

function deriveKey(masterKey: Buffer, purpose: string): Buffer {
  return Buffer.from(hkdfSync('sha256', masterKey, Buffer.alloc(0), `ses-agent-desktop/${purpose}/v1`, 32))
}

export function deriveApplicationKeys(masterKey: Buffer): ApplicationKeys {
  if (masterKey.length !== 32) throw new Error('Application master key must contain exactly 32 bytes.')
  return {
    databaseKey: deriveKey(masterKey, 'database'),
    mappingKey: deriveKey(masterKey, 'pii-mapping'),
    fileVaultKey: deriveKey(masterKey, 'file-vault')
  }
}
