import { describe, expect, it } from 'vitest'
import { requiresOwnCompany } from './own-company'
describe('explicit own-company requirement', () => {
  it.each(['自社', '貴社社員まで', '必须是自社', '需要自社要员', '自社社員のみ', '自社限定、非自社不可', '貴社社員限定', '御社所属社員のみ', '所属制限：自社', 'Java 自社限定', '自社要員必須', '仅限自社人员', '必须自己公司员工', '商流：貴社正社員のみ、BP不可'])('requires HR-owned affiliation for %s', (text) => expect(requiresOwnCompany(text)).toBe(true))
  it.each(['Java SQL', '不需要自社', '自社サービス開発', '自社社員歓迎', '自社優先', '自社社員のみではない', '自社限定なし', '自社社員・一社先社員まで', '自社社員限定ではなくBPも可', '非自社のみ', '自社・協力会社可', '自社社員または個人事業主可', '不要求自社', '自社以外も可', '"尚可:自社社員"'])('does not invent an own-company restriction for %s', (text) => expect(requiresOwnCompany(text)).toBe(false))
})
