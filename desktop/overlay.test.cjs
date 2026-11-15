const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');

test('floating UI preserves group alpha, requires explicit editing and still shares answers and screenshots', async()=>{
  const elements=new Map(),variables=new Map(),calls=[];let listener,canceled=true;
  const element=selector=>{if(!elements.has(selector)) {
    const classes=new Set(),attributes=new Map();
    elements.set(selector,{value:'',textContent:'',innerHTML:'',hidden:false,checked:false,dataset:{},style:{},
      classList:{toggle(name,on){if(on)classes.add(name);else classes.delete(name);},contains:name=>classes.has(name)},
      setAttribute:(name,value)=>attributes.set(name,value),getAttribute:name=>attributes.get(name),addEventListener(){},querySelectorAll:()=>[]});
  } return elements.get(selector);};
  const status={appearance:{theme:'light',overlayOpacity:0,overlayTextOpacity:.35,overlayFontSize:18},floating:{mode:'overlay',collapsed:false,shortcuts:[]},model:{model:'synthetic-model'},transcripts:[{segmentId:'one',speaker:'them',text:'一个合成的面试问题'}]};
  const context={Math,Date,document:{querySelector:element,documentElement:{dataset:{},style:{setProperty:(name,value)=>variables.set(name,value)}}},addEventListener(){},requestAnimationFrame:callback=>callback(),electronAPI:{}};
  context.window=context;context.studio={onEvent:callback=>{listener=callback;},invoke:async(name,data)=>{
    calls.push({name,data});if(name==='status')return status;
    if(name==='capture')return canceled?{canceled:true}:{path:'/synthetic/area.png',preview:'data:image/png;base64,c3ludGhldGlj'};
    if(name==='appearance'){status.appearance=data;listener({kind:'appearance',value:data});}
    return {success:true};
  }};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'overlay.js'),'utf8'),context);
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(variables.get('--background-alpha'),'0');assert.equal(variables.get('--ui-alpha'),'0.35');
  assert.equal(element('#floating-window').dataset.ghost,'true');
  element('#readable-editing').onclick();
  assert.equal(element('#floating-window').classList.contains('is-editing'),true);
  assert.equal(element('#readable-editing').getAttribute('aria-pressed'),'true');
  assert.equal(calls.filter(c=>c.name==='appearance').length,0,'Temporary editing must not overwrite saved alpha');
  listener({kind:'floating-state',value:{mode:'overlay',visible:false}});
  assert.equal(element('#floating-window').classList.contains('is-editing'),false);
  assert.equal(element('#readable-editing').textContent,'清晰编辑');
  element('#readable-editing').onclick();element('#readable-editing').onclick();
  assert.equal(element('#floating-window').classList.contains('is-editing'),false);
  await element('#quick-answer').onclick();let request=calls.find(c=>c.name==='ask').data;
  assert.equal(request.question,'一个合成的面试问题');assert.equal(request.images.length,0);
  listener({kind:'started',id:request.id,question:request.question});listener({kind:'token',id:request.id,column:'quick',text:'合成模型回答'});listener({kind:'done',id:request.id,ok:true});
  assert.equal(element('#answer-text').textContent,'合成模型回答');
  await element('#capture-answer').onclick();assert.equal(calls.filter(c=>c.name==='ask').length,1);
  canceled=false;await element('#capture-answer').onclick();request=calls.filter(c=>c.name==='ask').at(-1).data;
  assert.equal(request.task,'written');assert.deepEqual(Array.from(request.images),['/synthetic/area.png']);
  element('#readable-editing').onclick();
  await element('#ghost-preset').onclick();assert.equal(status.appearance.overlayOpacity,0);assert.equal(status.appearance.overlayTextOpacity,.35);
  assert.equal(element('#floating-window').classList.contains('is-editing'),false);
});
