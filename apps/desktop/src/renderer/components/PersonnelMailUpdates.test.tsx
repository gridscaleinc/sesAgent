import {act,fireEvent,render,screen,waitFor} from '@testing-library/react'
import {beforeEach,expect,it,vi} from 'vitest'
import {UiLocaleProvider} from '../i18n'
import {PersonnelMailUpdates} from './PersonnelMailUpdates'
const pending={id:'a'.repeat(64),documentId:'doc',field:'rate',previousValue:'88万円',currentValue:'90万円',value:'80万円',receivedAt:'2026-09-10T02:00:00Z',subject:'単価更新',evidence:'単価：80万円',status:'pending',reason:'manual-conflict'}
beforeEach(()=>Object.defineProperty(window,'sesAgent',{configurable:true,value:{listPersonnelMailUpdates:vi.fn(async()=>[pending]),resolvePersonnelMailUpdate:vi.fn(async()=>{})}}))
const show=()=>render(<UiLocaleProvider locale="zh-CN"><PersonnelMailUpdates documentId="doc" version={3}/></UiLocaleProvider>)
it('shows latest HR value against mail and requires an explicit choice with duplicate-click protection',async()=>{
 let done!:()=>void;vi.mocked(window.sesAgent.resolvePersonnelMailUpdate).mockImplementationOnce(()=>new Promise(resolve=>{done=resolve}))
 show();await screen.findByText('90万円 → 80万円')
 const apply=screen.getByRole('button',{name:'采用邮件条件'});fireEvent.click(apply);expect(apply).toBeDisabled();fireEvent.click(apply)
 expect(window.sesAgent.resolvePersonnelMailUpdate).toHaveBeenCalledTimes(1)
 expect(window.sesAgent.resolvePersonnelMailUpdate).toHaveBeenCalledWith({id:pending.id,action:'apply',expectedVersion:3})
 await act(async()=>done());expect(screen.queryByText('90万円 → 80万円')).not.toBeInTheDocument()
})
it('shows multi-person attribution without allowing automatic adoption',async()=>{
 vi.mocked(window.sesAgent.listPersonnelMailUpdates).mockResolvedValue([{...pending,reason:'multiple-people'}] as any)
 show();await screen.findByRole('button',{name:'已核对处理'})
 expect(screen.queryByRole('button',{name:'采用邮件条件'})).not.toBeInTheDocument()
 fireEvent.click(screen.getByRole('button',{name:'已核对处理'}))
 await waitFor(()=>expect(window.sesAgent.resolvePersonnelMailUpdate).toHaveBeenCalledWith({id:pending.id,action:'dismiss',expectedVersion:3}))
})
