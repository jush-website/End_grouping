import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('../apps-script/github-endpoint.gs',import.meta.url),'utf8');
function runtime(result){
 const calls=[];
 const context=vm.createContext({api:r=>{calls.push(r);return result;},HtmlService:{XFrameOptionsMode:{ALLOWALL:'ALLOWALL'},createHtmlOutput:html=>({html,setXFrameOptionsMode(mode){this.mode=mode;return this;}})}});
 vm.runInContext(source,context);
 return {calls,run:r=>context.doPost({parameter:{payload:JSON.stringify(r)}})};
}
test('GitHub endpoint accepts a nonce and returns only the API response to the fixed frontend',()=>{
 const rt=runtime({ok:true,data:{token:'fixture-session'}});
 const output=rt.run({path:'login',input:{password:'fixture-password'},replyNonce:'a'.repeat(32),origin:'https://untrusted.test'});
 assert.equal(rt.calls.length,1);assert.equal(output.mode,'ALLOWALL');
 assert.ok(output.html.includes('https://jush-website.github.io'));
 assert.ok(output.html.includes('fixture-session'));
 assert.ok(!output.html.includes('fixture-password'));
 assert.ok(!output.html.includes('https://untrusted.test'));
});
test('malformed callbacks never reach the registration mutation handler',()=>{
 const rt=runtime({ok:true,data:{}});
 rt.run({path:'groups',replyNonce:'bad'});
 assert.equal(rt.calls.length,0);
});
test('spreadsheet text cannot escape the bridge script',()=>{
 const rt=runtime({ok:true,data:{name:'</script><img src=x onerror=alert(1)>'}});
 const output=rt.run({path:'state',replyNonce:'b'.repeat(32)});
 assert.ok(!output.html.includes('</script><img'));
 const sent=[];
 const top={postMessage:(message,origin)=>sent.push({message,origin})};top.parent=top;
 const child={parent:top};
 const script=output.html.match(/<script>([\s\S]*)<\/script>/)[1];
 vm.runInNewContext(script,{window:child});
 assert.equal(sent[0].origin,'https://jush-website.github.io');
 assert.equal(sent[0].message.result.data.name,'</script><img src=x onerror=alert(1)>');
});
