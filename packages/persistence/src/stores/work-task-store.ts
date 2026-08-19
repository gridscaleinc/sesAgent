import { randomUUID } from 'node:crypto'
import { type WorkTask } from '@domain'
import { workTaskSchema } from '@shared'
import { type WorkTaskRow } from '../rows'
import { DomainStore } from './base'

export class WorkTaskStore extends DomainStore {
  listWorkTasks(): WorkTask[] {
    const rows = this.database
      .prepare<[], WorkTaskRow>('SELECT payload_json FROM work_tasks WHERE tombstone = 0 ORDER BY updated_at DESC')
      .all()
    return rows.map((row) => workTaskSchema.parse(JSON.parse(row.payload_json)))
  }

  getWorkTask(taskId: string): WorkTask | null {
    const row = this.database
      .prepare<[string], WorkTaskRow>('SELECT payload_json FROM work_tasks WHERE id = ? AND tombstone = 0')
      .get(taskId)
    return row ? workTaskSchema.parse(JSON.parse(row.payload_json)) : null
  }

  countWorkTasks(): number {
    const row = this.database
      .prepare<[], { count: number }>('SELECT count(*) AS count FROM work_tasks WHERE tombstone = 0')
      .get()
    return row?.count ?? 0
  }

  saveWorkTask(task: WorkTask): void {
    const validated = workTaskSchema.parse(task)
    const save = this.database.transaction(() => {
      this.database
        .prepare(
          `INSERT INTO work_tasks(id, type, status, title, payload_json, revision, tombstone, created_at, updated_at)
           VALUES (@id, @type, @status, @title, @payload, 1, 0, @createdAt, @updatedAt)
           ON CONFLICT(id) DO UPDATE SET
             type = excluded.type,
             status = excluded.status,
             title = excluded.title,
             payload_json = excluded.payload_json,
             revision = work_tasks.revision + 1,
             tombstone = 0,
             updated_at = excluded.updated_at`
        )
        .run({
          id: validated.id,
          type: validated.type,
          status: validated.status,
          title: validated.title,
          payload: JSON.stringify(validated),
          createdAt: validated.createdAt,
          updatedAt: validated.updatedAt
        })
      const revision = this.database
        .prepare<[string], { revision: number }>('SELECT revision FROM work_tasks WHERE id = ?')
        .get(validated.id)?.revision
      this.database
        .prepare(
          'INSERT INTO change_outbox(id, entity_type, entity_id, revision, operation, created_at) VALUES (?, ?, ?, ?, ?, ?)'
        )
        .run(randomUUID(), 'work_task', validated.id, revision ?? 1, 'upsert', new Date().toISOString())
    })
    save()
  }
}
