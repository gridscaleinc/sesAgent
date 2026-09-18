import {expect,it} from 'vitest'
import {extractPersonnelMailConditions} from './gmail-personnel-intake'
it('reads explicit business conditions and the updated value, preserving other text',()=>{
 expect(extractPersonnelMailConditions('単価：90万円→75万円，稼働：10月\n勤務形態：リモート\n希望勤務地：東京')).toEqual([{field:'rate',value:'75万円'},{field:'availability',value:'10月'},{field:'work_style',value:'リモート'},{field:'location',value:'東京'}])
})
it('does not guess conditions from unlabelled prose or repeated labels',()=>{
 expect(extractPersonnelMailConditions('A 単価：90万円\n単価：80万円\n単価：75万円\nJavaで5年、10月から予定')).toEqual([])
 expect(extractPersonnelMailConditions('単価：90万円→')).toEqual([])
})
