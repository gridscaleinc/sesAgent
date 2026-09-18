import { useEffect, useRef, useState } from 'react'
import type { MatchingOpportunity } from '@shared'
import { useUiLocale } from '../i18n'
export function MatchingOpportunities({active,onOpen}:{active:boolean;onOpen(item:MatchingOpportunity):void}){
 const zh=useUiLocale()==='zh-CN',t=(cn:string,ja:string)=>zh?cn:ja
 const [rows,setRows]=useState<MatchingOpportunity[]>([]),[error,setError]=useState(''),[busy,setBusy]=useState(false);const lock=useRef(false)
 useEffect(()=>{if(!active||!window.sesAgent.listMatchingOpportunities)return;let live=true;const refresh=()=>{void window.sesAgent.listMatchingOpportunities().then(r=>{if(live){setRows(r);setError('')}}).catch(e=>{if(live)setError(String(e))})};refresh();const timer=setInterval(refresh,20000);window.addEventListener('ses-business-data-changed',refresh);return()=>{live=false;clearInterval(timer);window.removeEventListener('ses-business-data-changed',refresh)}},[active])
 const act=async(item:MatchingOpportunity,action:'seen'|'dismissed')=>{if(lock.current)return;lock.current=true;setBusy(true);setError('');try{setRows(await window.sesAgent.controlMatchingOpportunity({id:item.id,fingerprint:item.fingerprint,action}));if(action==='seen')onOpen(item)}catch(e){setError(String(e))}finally{lock.current=false;setBusy(false)}}
 if(!rows.length&&!error)return null
 return <details className="matching-opportunities"><summary>{t('新匹配机会','新しいマッチング候補')} ({rows.filter(r=>r.state==='new').length})</summary><p>{t('根据最新资料在后台发现，以下为本地依据；打开后可进行完整匹配评估。','最新情報からバックグラウンドで見つけたローカル候補です。開くと詳しい評価を確認できます。')}</p>{error?<p role="alert">{error}</p>:null}{rows.slice(0,10).map(row=><article className="work-rule-card" key={row.id}><strong>{row.personName} · {row.caseTitle}</strong><p>{t('已有依据','確認できる根拠')}：{row.reasons.join(' · ')}</p>{row.confirm.length?<p>{t('待确认','要確認')}：{row.confirm.join(' · ')}</p>:null}<div className="work-rule-actions"><button disabled={busy} onClick={()=>void act(row,'seen')}>{t('查看匹配','マッチングを見る')}</button><button disabled={busy} onClick={()=>void act(row,'dismissed')}>{t('暂不关注此组合','この組み合わせを非表示')}</button></div></article>)}</details>
}
