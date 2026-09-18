import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {afterEach,beforeEach,expect,it} from 'vitest'
import {loadGoogleProductBuildVariables,requireGoogleProductBuildConfiguration} from './google-product-configuration'
let root:string
const installed={client_id:'1234567890-product.apps.googleusercontent.com',client_secret:'test-only-not-a-real-secret',auth_uri:'https://accounts.google.com/o/oauth2/auth',token_uri:'https://oauth2.googleapis.com/token'}
beforeEach(()=>{root=mkdtempSync(join(tmpdir(),'ses-google-product-'));mkdirSync(join(root,'.local'))})
afterEach(()=>rmSync(root,{recursive:true,force:true}))
it('loads publisher desktop configuration without requiring shell exports',()=>{
 writeFileSync(join(root,'.local/google-oauth-desktop.json'),JSON.stringify({installed}))
 expect(loadGoogleProductBuildVariables(root,{})).toEqual({SES_GOOGLE_OAUTH_CLIENT_ID:installed.client_id,SES_GOOGLE_OAUTH_CLIENT_SECRET:installed.client_secret})
})
it('rejects Web credentials and never exposes their contents in errors',()=>{
 writeFileSync(join(root,'.local/google-oauth-desktop.json'),JSON.stringify({web:installed}))
 expect(()=>loadGoogleProductBuildVariables(root,{})).toThrow('Desktop app JSON')
 try{loadGoogleProductBuildVariables(root,{})}catch(error){expect(String(error)).not.toContain(installed.client_secret)}
})
it('rejects a missing explicit configuration and blocks unconfigured distribution builds',()=>{
 expect(()=>loadGoogleProductBuildVariables(root,{SES_GOOGLE_OAUTH_CONFIG_FILE:'missing.json'})).toThrow('does not exist')
 expect(loadGoogleProductBuildVariables(root,{})).toEqual({})
 expect(()=>requireGoogleProductBuildConfiguration({})).toThrow('Cannot build a distributable')
})
it('keeps CI credentials separate from an unrelated local file',()=>{
 writeFileSync(join(root,'.local/google-oauth-desktop.json'),JSON.stringify({installed}))
 expect(loadGoogleProductBuildVariables(root,{SES_GOOGLE_OAUTH_CLIENT_ID:'9876543210-ci.apps.googleusercontent.com'})).toEqual({SES_GOOGLE_OAUTH_CLIENT_ID:'9876543210-ci.apps.googleusercontent.com'})
})
