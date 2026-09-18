import {act,cleanup,render,screen,waitFor} from '@testing-library/react'
import {afterEach,expect,it,vi} from 'vitest'
import type {CandidateInterviewSnapshot,InterviewAnswers} from '@shared'
import {InterviewRoundEvidence} from './InterviewRoundEvidence'
vi.mock('../i18n',()=>({useUiLocale:()=> 'zh-CN'}))
afterEach(cleanup)
const round={id:'i',updatedAt:'1',decision:null,interviewNotes:'本人负责 Java API 实现。',questionPlan:[{id:'standard-1',text:'本人设计职责',selected:true}]} as CandidateInterviewSnapshot
const data={interviewId:'i',sourceHash:'hash',updatedAt:'1',answers:[{questionId:'standard-1',status:'partial',quote:round.interviewNotes!,summary:'实现职责',remaining:'设计待核实'}]} satisfies InterviewAnswers
it('clears old answers while a changed saved record is loading and ignores late results',async()=>{
 let resolveOld!:(value:InterviewAnswers)=>void
 const getInterviewAnswers=vi.fn().mockResolvedValueOnce(data).mockImplementationOnce(()=>new Promise(resolve=>{resolveOld=resolve})).mockResolvedValueOnce(null)
 Object.defineProperty(window,'sesAgent',{configurable:true,value:{getInterviewAnswers}})
 const {rerender}=render(<InterviewRoundEvidence interview={round}/>)
 await screen.findByText('本人负责 Java API 实现。')
 rerender(<InterviewRoundEvidence interview={{...round,updatedAt:'2',interviewNotes:'尚未讨论设计职责'}}/> )
 expect(screen.queryByText('本人负责 Java API 实现。')).not.toBeInTheDocument()
 rerender(<InterviewRoundEvidence interview={{...round,id:'second',updatedAt:'3',interviewNotes:''}}/> )
 await act(async()=>resolveOld(data))
 await screen.findByText('本轮尚未保存回答记录。')
 expect(screen.queryByText('设计待核实')).not.toBeInTheDocument()
})
it('clears stale answers on refresh failure',async()=>{
 vi.useFakeTimers()
 try{
 const getInterviewAnswers=vi.fn().mockResolvedValueOnce(data).mockRejectedValueOnce(new Error('offline'))
 Object.defineProperty(window,'sesAgent',{configurable:true,value:{getInterviewAnswers}})
 render(<InterviewRoundEvidence interview={round}/>)
 await act(async()=>{})
 expect(screen.getByText('本人负责 Java API 实现。')).toBeInTheDocument()
 await act(async()=>vi.advanceTimersByTimeAsync(20000))
 expect(screen.getByRole('alert')).toBeInTheDocument()
 expect(screen.queryByText('本人负责 Java API 实现。')).not.toBeInTheDocument()
 }finally{vi.useRealTimers()}
})
it('does not display evidence from another round or an unselected question',async()=>{
 const getInterviewAnswers=vi.fn().mockResolvedValue({...data,interviewId:'other'})
 Object.defineProperty(window,'sesAgent',{configurable:true,value:{getInterviewAnswers}})
 render(<InterviewRoundEvidence interview={round}/>)
 await waitFor(()=>expect(getInterviewAnswers).toHaveBeenCalledWith('i'))
 expect(screen.queryByText('本人负责 Java API 实现。')).not.toBeInTheDocument()
})
