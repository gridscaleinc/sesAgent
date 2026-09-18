import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { baseExperienceSkills, type SystemExperienceSnapshot } from '@shared'
import { SystemExperiencePanel } from './SystemExperiencePanel'
vi.mock('../i18n', () => ({ useUiLocale: () => 'zh-CN' }))
let snapshot:SystemExperienceSnapshot
beforeEach(()=>{
  snapshot={settings:{enabled:true,dailyCallLimit:16,callsToday:2,budgetDate:'2026-09-16',lastAttempt:null,lastCompleted:null,lastError:null,revision:4},bases:baseExperienceSkills,eventCount:5,pendingCount:0,
    experiences:[{id:'skill-1',task:'matching',method:'ownership',keyword:'Java',version:3,enabled:true,locked:false,state:'trial',support:['event-1'],evaluations:[],createdAt:'2026-09-16T00:00:00Z',previousVersion:2,reason:'独立比较通过 / 検証通過',uses:4}]}
  Object.defineProperty(window,'sesAgent',{configurable:true,value:{
    getSystemExperience:vi.fn(async()=>structuredClone(snapshot)),
    controlSystemExperience:vi.fn(async input=>{ if(input.action==='learning')snapshot.settings={...snapshot.settings,enabled:input.enabled,revision:5};else if(input.action==='enable')snapshot.experiences[0]={...snapshot.experiences[0]!,enabled:input.enabled,state:'paused',version:4};return structuredClone(snapshot) }),
    getSystemExperienceDetails:vi.fn(async()=>({history:[snapshot.experiences[0]!],evidence:[{id:'event-1',text:'本人职责应进一步确认',createdAt:'2026-09-16T00:00:00Z'}]}))
  }})
})
afterEach(cleanup)
it('fetches only when the optional settings section is open',async()=>{
  const {rerender}=render(<SystemExperiencePanel active={false}/>);expect(window.sesAgent.getSystemExperience).not.toHaveBeenCalled()
  rerender(<SystemExperiencePanel active/>);await screen.findByText('核实本人负责范围')
  expect(screen.getByRole('textbox',{name:'搜索问题'})).toBeInTheDocument()
  expect(screen.queryByRole('textbox',{name:/提示词/})).not.toBeInTheDocument()
})
it('pauses background learning without disabling accepted methods',async()=>{
  render(<SystemExperiencePanel/>);fireEvent.click(await screen.findByRole('button',{name:'暂停学习'}))
  await screen.findByRole('button',{name:'恢复学习'})
  expect(window.sesAgent.controlSystemExperience).toHaveBeenCalledWith({action:'learning',enabled:false,expectedRevision:4})
  expect(screen.getByRole('button',{name:'停用这条经验'})).toBeInTheDocument()
})
it('uses the current version when disabling a method and displays source evidence on request',async()=>{
  render(<SystemExperiencePanel/>);fireEvent.click(await screen.findByRole('button',{name:'依据与版本记录'}))
  await screen.findByText('本人职责应进一步确认')
  fireEvent.click(screen.getByRole('button',{name:'停用这条经验'}))
  await waitFor(()=>expect(window.sesAgent.controlSystemExperience).toHaveBeenCalledWith({action:'enable',id:'skill-1',expectedVersion:3,enabled:false}))
  await screen.findByRole('button',{name:'恢复使用'})
})
it('keeps the existing state visible after a stale-version failure',async()=>{
  vi.mocked(window.sesAgent.controlSystemExperience).mockRejectedValue(new Error('系统经验已更新，请刷新。'))
  render(<SystemExperiencePanel/>);fireEvent.click(await screen.findByRole('button',{name:'停用这条经验'}))
  expect(await screen.findByRole('alert')).toHaveTextContent('系统经验已更新')
  expect(screen.getByRole('button',{name:'停用这条经验'})).toBeInTheDocument()
})
it('shows the actual method, scope, and accepted fallback while a new version is validating',async()=>{
 snapshot.experiences[0]={...snapshot.experiences[0]!,state:'validating',enabled:false,servingVersion:2,
  scope:{kind:'customer',owner:'hr',key:'client',label:'客户甲',locale:'zh-CN'},
  procedure:{title:'围绕职责核对证据',steps:['逐个项目核对本人负责的设计决策与交付物。'],avoid:['不将参与项目等同于独立负责。']}}
 render(<SystemExperiencePanel/>)
 await screen.findByText('围绕职责核对证据')
 expect(screen.getByText('逐个项目核对本人负责的设计决策与交付物。')).toBeInTheDocument()
 expect(screen.getByText(/验证期间继续使用/)).toHaveTextContent('v2')
 fireEvent.change(screen.getByRole('combobox',{name:'查看适用范围'}),{target:{value:'personal'}})
 expect(screen.queryByText('围绕职责核对证据')).not.toBeInTheDocument()
 fireEvent.change(screen.getByRole('combobox',{name:'查看适用范围'}),{target:{value:'customer'}})
 fireEvent.click(screen.getByRole('button',{name:'停用这条经验'}))
 await waitFor(()=>expect(window.sesAgent.controlSystemExperience).toHaveBeenCalledWith({action:'enable',id:'skill-1',expectedVersion:3,enabled:false}))
})
