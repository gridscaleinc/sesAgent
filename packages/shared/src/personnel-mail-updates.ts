import { z } from 'zod'
export const personnelMailConditionFields = ['rate','availability','work_style','location'] as const
export const personnelMailConditionsSchema = z.array(z.object({ field:z.enum(personnelMailConditionFields),value:z.string().trim().min(1).max(1000) }).strict()).max(4)
export interface PersonnelMailUpdate {
  id:string; documentId:string; field:typeof personnelMailConditionFields[number]; currentValue?:string|null; previousValue:string|null; value:string;
  receivedAt:string; subject:string; evidence:string; status:'pending'|'applied'|'dismissed'|'superseded'; reason:'manual-conflict'|'multiple-people'|null
}
export const resolvePersonnelMailUpdateSchema=z.object({id:z.string().regex(/^[a-f0-9]{64}$/u),action:z.enum(['apply','dismiss']),expectedVersion:z.number().int().positive()}).strict()
export type ResolvePersonnelMailUpdateInput=z.infer<typeof resolvePersonnelMailUpdateSchema>
