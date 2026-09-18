import { useEffect, useRef, useState } from 'react'
import type { RegenerateIntroductionInput } from '@shared'

type Trace={text:string;experienceRunId?:string}
/** Personnel proposals require cloud generation; other drafts can use local text with optional learned wording. Never overwrite an edit. */
export function useIntroductionExperience(key:string,input:RegenerateIntroductionInput|null,initial:string,valid:boolean,cloudFirst=false) {
  const [traces,setTraces]=useState<Record<string,Trace>>({})
  const [cloudState,setCloudState]=useState<Record<string,{status:'generating'|'ready'|'failed';error?:string}>>({})
  const attempted=useRef(new Set<string>())
  const current=useRef<Record<string,Trace>>({}), edited=useRef(new Set<string>()),pending=useRef(new Map<string,Promise<Trace|undefined>>())
  const activeKey=useRef<string|null>(null)
  const encoded=JSON.stringify(input)
  useEffect(()=>{activeKey.current=key;return ()=>{activeKey.current=null}},[key])
  const put=(target:string,value:Trace)=>{current.current[target]=value;setTraces(previous=>({...previous,[target]:value}))}
  useEffect(()=>{
    if(cloudFirst){
      if(!valid||!input||!key||!initial.trim()||current.current[key]||attempted.current.has(key))return
      attempted.current.add(key)
      setCloudState(previous=>({...previous,[key]:{status:'generating'}}))
      const request=Promise.resolve().then(()=>window.sesAgent.regenerateIntroduction(input)).then(result=>{
        if(!result?.text?.trim())throw new Error('云端未返回提案文，请重新生成。 / Cloudから提案文が返されませんでした。再生成してください。')
        if(!edited.current.has(key)&&!current.current[key])put(key,result)
        setCloudState(previous=>({...previous,[key]:{status:'ready'}}))
        return result
      }).catch(cause=>{
        setCloudState(previous=>({...previous,[key]:{status:'failed',error:cause instanceof Error?cause.message:String(cause)}}))
        return undefined
      }).finally(()=>pending.current.delete(key))
      pending.current.set(key,request)
      return
    }
    if(!valid||!input||!key||!initial.trim()||!window.sesAgent.beginIntroductionDraft||current.current[key]||pending.current.has(key))return
    const request=window.sesAgent.beginIntroductionDraft({...input,text:initial}).then(async result=>{
      if(!result)return undefined
      if(current.current[key])return current.current[key]
      const local={text:initial,experienceRunId:result.experienceRunId}
      put(key,local)
      if(result.hasExperience&&!edited.current.has(key)&&activeKey.current===key){
        // Keep the local trace ready for copy/email while background wording runs.
        void window.sesAgent.regenerateIntroduction(input).then(generated=>{
          if(activeKey.current===key&&!edited.current.has(key)&&current.current[key]===local)put(key,generated)
        }).catch(()=>{})
      }
      return local
    }).catch(()=>undefined).finally(()=>pending.current.delete(key))
    pending.current.set(key,request)
  },[key,encoded,initial,valid,cloudFirst])
  return {text:traces[key]?.text??(cloudFirst?'':initial),
    generating:cloudFirst&&valid&&Boolean(initial.trim())&&(!cloudState[key]||cloudState[key]?.status==='generating'),
    error:cloudFirst?cloudState[key]?.error:undefined,
    markEdited:()=>edited.current.add(key),
    replace:(value:Trace)=>{edited.current.delete(key);put(key,value);setCloudState(previous=>({...previous,[key]:{status:'ready'}}))},
    runId:async()=>{edited.current.add(key);if(pending.current.has(key))await pending.current.get(key);return current.current[key]?.experienceRunId}}
}
