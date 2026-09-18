import { StrictMode, type PropsWithChildren } from 'react'
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { useIntroductionExperience } from './use-introduction-experience'
const input={kind:'case' as const,id:'case',version:1,lang:'zh' as const,style:'brief' as const}
const wrapper=({children}:PropsWithChildren)=><StrictMode>{children}</StrictMode>
afterEach(cleanup)
function setup(){
 let finish:(value:any)=>void=()=>{}
 const begin=vi.fn(async()=>({text:'初始介绍',experienceRunId:'local',hasExperience:true}))
 const generate=vi.fn(()=>new Promise<any>(resolve=>{finish=resolve}))
 Object.defineProperty(window,'sesAgent',{configurable:true,value:{beginIntroductionDraft:begin,regenerateIntroduction:generate}})
 const hook=renderHook(()=>useIntroductionExperience('key',input,'初始介绍',true),{wrapper})
 return {hook,begin,generate,finish:()=>finish({text:'采用经验后的介绍',experienceRunId:'learned'})}
}
it('applies learned wording once under StrictMode and binds the generated run',async()=>{
 const {hook,begin,generate,finish}=setup()
 await waitFor(()=>expect(generate).toHaveBeenCalledTimes(1))
 expect(begin).toHaveBeenCalledTimes(1)
 await act(async()=>finish())
 expect(hook.result.current.text).toBe('采用经验后的介绍')
 expect(await hook.result.current.runId()).toBe('learned')
})
it('never replaces a draft after the HR starts editing',async()=>{
 const {hook,generate,finish}=setup()
 await waitFor(()=>expect(generate).toHaveBeenCalledTimes(1))
 act(()=>hook.result.current.markEdited())
 await act(async()=>finish())
 expect(hook.result.current.text).toBe('初始介绍')
 expect(await hook.result.current.runId()).toBe('local')
})
it('freezes provenance when copying before background generation completes',async()=>{
 const {hook,generate,finish}=setup()
 await waitFor(()=>expect(generate).toHaveBeenCalledTimes(1))
 expect(await hook.result.current.runId()).toBe('local')
 await act(async()=>finish())
 expect(hook.result.current.text).toBe('初始介绍')
})
it('does not replace a manually regenerated draft with an earlier background result',async()=>{
 const {hook,generate,finish}=setup()
 await waitFor(()=>expect(generate).toHaveBeenCalledTimes(1))
 act(()=>hook.result.current.replace({text:'主动重新生成',experienceRunId:'manual'}))
 await act(async()=>finish())
 expect(hook.result.current.text).toBe('主动重新生成')
 expect(await hook.result.current.runId()).toBe('manual')
})

it('calls cloud immediately without requiring learned experience and never presents a local excerpt as the draft',async()=>{
 let finish:(value:any)=>void=()=>{}
 const generate=vi.fn(()=>new Promise<any>(resolve=>{finish=resolve}))
 const begin=vi.fn(async()=>({hasExperience:false}))
 Object.defineProperty(window,'sesAgent',{configurable:true,value:{beginIntroductionDraft:begin,regenerateIntroduction:generate}})
 const hook=renderHook(()=>useIntroductionExperience('cloud',input,'本地项目摘录',true,true),{wrapper})
 await waitFor(()=>expect(generate).toHaveBeenCalledTimes(1))
 expect(begin).not.toHaveBeenCalled()
 expect(hook.result.current.text).toBe('')
 expect(hook.result.current.generating).toBe(true)
 await act(async()=>finish({text:'Java／Spring Bootによる開発経験があります。',experienceRunId:'cloud-run'}))
 expect(hook.result.current.text).toContain('Java／Spring Boot')
 expect(hook.result.current.generating).toBe(false)
 expect(await hook.result.current.runId()).toBe('cloud-run')
})

it('shows a cloud failure without substituting local content and clears it on explicit retry',async()=>{
 const generate=vi.fn(async()=>{throw new Error('cloud offline')})
 Object.defineProperty(window,'sesAgent',{configurable:true,value:{regenerateIntroduction:generate}})
 const hook=renderHook(()=>useIntroductionExperience('failed',input,'本地项目摘录',true,true),{wrapper})
 await waitFor(()=>expect(hook.result.current.error).toBe('cloud offline'))
 expect(hook.result.current.text).toBe('')
 expect(generate).toHaveBeenCalledTimes(1)
 act(()=>hook.result.current.replace({text:'再生成の結果',experienceRunId:'retry'}))
 expect(hook.result.current.error).toBeUndefined()
 expect(hook.result.current.text).toBe('再生成の結果')
})
