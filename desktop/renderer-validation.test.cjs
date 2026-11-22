const test=require('node:test'), assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');

async function fixture() {
  const elements=new Map(),calls=[],eventButtons=[];let finishOCR,failOCR;
  const element=selector=>{
    if(!elements.has(selector))elements.set(selector,{value:'',checked:false,textContent:'',innerHTML:'',disabled:false,
      classList:{toggle(){}},querySelectorAll:()=>[],addEventListener(){},focus(){}});
    return elements.get(selector);
  };
  const nav=['interview','written','records'].map(view=>({dataset:{view},classList:{toggle(){}}}));
  const history={task:'written',question:'历史题目：计算42的含义',answers:{quick:'历史回答'},date:'synthetic',model:'fixture'};
  const viewRecord={dataset:{answer:'0'}};eventButtons.push(viewRecord);
  const status={sessionActive:false,model:{model:'fixture'},speech:{configured:true},permissions:{},transcripts:[],preparation:{},captureSettings:{captureMicrophone:false}};
  const context={document:{querySelector:element,querySelectorAll:s=>s==='[data-view]'?nav:s==='[data-answer]'?eventButtons:[]},
    electronAPI:{onNativeAudioTranscript(){},onMeetingStateChanged(){},onSessionReset(){},onGlobalShortcut(){},getRecentMeetings:async()=>[]},
    addEventListener(){},requestAnimationFrame:fn=>fn()};
  context.window=context;context.studio={onEvent(){},invoke:async(name,data)=>{
    calls.push({name,data});if(name==='status')return status;
    if(name==='records')return [history];
    if(name==='image-import')return {path:'/synthetic/new-question.png',preview:'data:image/png;base64,fixture'};
    if(name==='image-recognize')return new Promise((resolve,reject)=>{finishOCR=resolve;failOCR=reject;});
    return {success:true};
  }};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'renderer.js'),'utf8'),context);
  await new Promise(resolve=>setImmediate(resolve));
  return {element,nav,calls,viewRecord,completeOCR:text=>finishOCR({text}),failOCR:error=>failOCR(error)};
}

test('pending image recognition prevents switching task until its result is applied',async()=>{
  const f=await fixture();f.element('#question').value='面试草稿';await f.nav[1].onclick();await f.element('#import-question-image').onclick();
  const recognizing=f.element('#recognize-question').onclick();await Promise.resolve();
  await f.nav[0].onclick();
  assert.match(f.element('#notice').textContent,/图片处理/);
  f.completeOCR('识别出的笔试题');await recognizing;await f.nav[0].onclick();
  assert.equal(f.element('#question').value,'面试草稿');
});

test('an OCR result never overwrites a question the user edited while it was running',async()=>{
  const f=await fixture();await f.nav[1].onclick();await f.element('#import-question-image').onclick();
  f.element('#question').value='原始草稿';const recognizing=f.element('#recognize-question').onclick();await Promise.resolve();
  f.element('#question').value='用户手工修改的题目';f.completeOCR('迟到的识别结果');await recognizing;
  assert.equal(f.element('#question').value,'用户手工修改的题目');assert.match(f.element('#notice').textContent,/未覆盖/);
});

test('opening a historical answer replaces the prompt and clears unrelated current images',async()=>{
  const f=await fixture();await f.nav[1].onclick();await f.element('#import-question-image').onclick();f.element('#question').value='另一道未提交的新题';
  await f.nav[2].onclick();await f.viewRecord.onclick();
  assert.equal(f.element('#question').value,'历史题目：计算42的含义');
  assert.equal(f.element('#attachments').innerHTML,'');assert.match(f.element('#notice').textContent,/重新附加/);
});

test('failed OCR releases the operation lock and allows another task without losing its draft',async()=>{
  const f=await fixture();f.element('#question').value='原面试草稿';await f.nav[1].onclick();await f.element('#import-question-image').onclick();
  const recognizing=f.element('#recognize-question').onclick();await Promise.resolve();
  assert.equal(f.element('#ask').disabled,true);
  await f.element('#ask').onclick();assert.equal(f.calls.some(c=>c.name==='ask'),false);
  f.failOCR(new Error('OCR fixture failure'));await recognizing;
  assert.equal(f.element('#ask').disabled,false);assert.equal(f.element('#recognize-question').disabled,false);
  assert.match(f.element('#notice').textContent,/OCR fixture failure/);
  await f.nav[0].onclick();assert.equal(f.element('#question').value,'原面试草稿');
});
