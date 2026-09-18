import { expect, it } from 'vitest'
import { redactTextForCloud } from '@privacy'
import { createCloudRecordAliases } from './cloud-record-aliases'

it('keeps UUID correlation local without weakening postal address detection', () => {
  const id = 'aaaaaaaa-a123-4567-8abc-aaaaaaaaaaaa'
  const options = { sourceVersion: 'fixture', personNameReviewCompleted: true as const }
  expect(redactTextForCloud(JSON.stringify({ id }), options).blockedReasons).toContain('residual:postal_address')
  const aliases = createCloudRecordAliases()
  const projection = aliases.project({ id, runs: [{ id }], text: '郵便番号 123-4567' }) as { id: string; runs: { id: string }[]; text: string }
  expect(projection.id).toMatch(/^aaaaaaaa-aaaa-4aaa-aaaa-[a-f]{12}$/)
  expect(projection.runs[0]!.id).toBe(projection.id)
  expect(aliases.original(projection.id)).toBe(id)
  expect(aliases.original(id)).toBeUndefined()
  expect(projection.text).toBe('郵便番号 123-4567')
  expect(redactTextForCloud(JSON.stringify({ id: projection.id }), options).session.status).toBe('passed')
  expect(redactTextForCloud(JSON.stringify(projection), options).blockedReasons).toContain('residual:postal_address')
  expect(new Set(Array.from({ length: 40 }, (_, index) => aliases.alias(String(index)))).size).toBe(40)
})
