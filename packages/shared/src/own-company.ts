/** Explicit supplier-owned personnel restrictions, not a preference or a project description. */
export function requiresOwnCompany(text: string): boolean {
  const normalized = text.normalize('NFKC').replace(/"尚可:[^"]*"/gu, '').trim()
  return normalized.split(/[\n。；;]/u).some((line) => {
    if (/(?:自社|貴社|御社).{0,12}(?:限定|のみ|必須).{0,4}(?:ではない|でない|ではなく|不要|なし|無し)|(?:不要求|不需要|无需|不限于|不限於|非必须|非必須).{0,5}自社/u.test(line)) return false
    if (/(?:非自社|自社以外|自社外)(?:のみ|限定|必須|も可)/u.test(line)) return false
    // A chain allowing partner staff is not an own-company-only restriction.
    if (/(?:協力会社|他社|BP|bp|一社先|1社先|個人事業主|非自社).{0,8}(?<!不)(?:可|OK|ok|可能|まで|不限|不問)|(?:可|允许|允許).{0,4}(?:非自社|他社|協力会社)/u.test(line)) return false
    const own = '(?:自社|貴社|御社|自己公司|本公司)(?:(?:の|所属)?(?:正社員|契約社員|社員|要員|要员|人材|人员|員工|员工))?'
    return new RegExp(`(?:${own}\\s*(?:のみ|限定|必須|限り|まで|才可|才行)|(?:仅限|僅限|必须|必須|需要|要求|只限|限定)(?:是|为|為)?\\s*${own})`, 'u').test(line)
      || new RegExp(`^(?:(?:所属|所属制限|商流|契約・商流|人员要求)\\s*[:：]\\s*)?${own}$`, 'u').test(line.trim())
  })
}
