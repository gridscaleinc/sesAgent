/**
 * Pages the app can show. The HR shell ('agent': the 案件 / 人员 / 跟进 lists with their right panel) is home;
 * every other page is a sub-page of one HR section — 案件 → 批量导入, 人员 → 招聘面试, 跟进 → 面试日程 — or,
 * for the cross-object pages (activity, one task, review center), of the section it was opened from.
 * The section stays highlighted in the rail and the return bar reads 「返回<section>」.
 */
export type AppView = 'agent' | 'case-import' | 'interview-workbench' | 'interview-schedule' | 'reviews' | 'tasks' | 'task'
