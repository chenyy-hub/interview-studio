const test = require('node:test');
const assert = require('node:assert/strict');
const { createFloating } = require('./floating.cjs');

function fixture(conflicts = new Set(), directModes = false) {
  const keys = new Map(), hooks = {}, messages = [], changes = []; let mode='launcher', visible=false, mouse=false, size=[600,480];
  const win={isDestroyed:()=>false,isVisible:()=>visible,hide:()=>{visible=false;},getSize:()=>size,setSize:(w,h)=>{size=[w,h];},setMinimumSize(){},on(){},webContents:{send:(...data)=>messages.push(data)}};
  const helper={getCurrentWindowMode:()=>mode,getOverlayWindow:()=>win,getLauncherWindow:()=>win,setWindowMode:next=>{mode=next;visible=next==='overlay';}};
  if (directModes) {
    helper.switchToOverlay=()=>{mode='overlay';visible=true;};helper.switchToLauncher=()=>{mode='launcher';visible=false;};
    helper.setWindowMode=next=>helper[next==='overlay'?'switchToOverlay':'switchToLauncher']();
  }
  const appState={windowHelper:helper,getOverlayMousePassthrough:()=>mouse,setOverlayMousePassthrough:value=>{mouse=value;}};
  const floating=createFloating({app:{on:(name,callback)=>{hooks[name]=callback;}},appState,globalShortcut:{register:(key,callback)=>{if(conflicts.has(key)||keys.has(key))return false;keys.set(key,callback);return true;},unregister:key=>keys.delete(key)},onChange:value=>changes.push(value)});
  return {floating,keys,hooks,messages,win,appState,size:()=>size};
}

test('floating mode can collapse, recover mouse input, route quick actions and leave without trapping clicks', () => {
  const f=fixture();
  assert.throws(()=>f.floating.run({action:'passthrough',enabled:true}),/打开悬浮窗/);
  f.keys.get('CommandOrControl+Shift+O')();
  assert.equal(f.floating.status().visible,true);
  f.floating.run({action:'collapse',enabled:true});assert.equal(f.size()[1],48);
  f.floating.run({action:'collapse',enabled:false});assert.equal(f.size()[1],480);
  f.keys.get('CommandOrControl+Shift+A')();assert.equal(f.messages.at(-1)[1].action,'quick');
  f.keys.get('CommandOrControl+Shift+U')();assert.equal(f.floating.status().passthrough,true);
  f.floating.run({action:'hide'});f.keys.get('CommandOrControl+Shift+U')();assert.equal(f.floating.status().passthrough,false);
  f.floating.run({action:'open'});f.floating.run({action:'passthrough',enabled:true});
  f.appState.windowHelper.setWindowMode('launcher');assert.equal(f.floating.status().passthrough,false);
  assert.equal(f.keys.has('CommandOrControl+Shift+Up'),false);
  f.keys.set('external-shortcut',()=>{});f.hooks['will-quit']();assert.equal(f.keys.size,1);
});

test('a conflicting recovery shortcut is reported and blocks click-through without a tray recovery route', () => {
  const f=fixture(new Set(['CommandOrControl+Shift+U']));f.floating.run({action:'open'});
  assert.equal(f.floating.status().shortcuts.find(s=>s.id==='passthrough').conflict,true);
  assert.throws(()=>f.floating.run({action:'passthrough',enabled:true}),/恢复快捷键被占用/);
  assert.equal(f.floating.status().passthrough,false);
});

test('direct upstream mode switches also reset click-through and update scrolling shortcuts', () => {
  const f=fixture(new Set(),true);f.floating.run({action:'open'});f.floating.run({action:'passthrough',enabled:true});
  f.appState.windowHelper.switchToLauncher();
  assert.equal(f.floating.status().passthrough,false);assert.equal(f.keys.has('CommandOrControl+Shift+Up'),false);
  f.appState.windowHelper.switchToOverlay();assert.equal(f.keys.has('CommandOrControl+Shift+Up'),true);
});

test('compatibility releases only owned shortcuts and background actions target the current workbench', () => {
  const f=fixture();
  f.keys.get('CommandOrControl+Shift+F8')(); assert.equal(f.messages.at(-1)[1].action,'pause');
  f.keys.get('CommandOrControl+Shift+F7')(); assert.equal(f.messages.at(-1)[1].action,'finish');
  f.keys.get('CommandOrControl+Shift+F11')(); assert.equal(f.messages.at(-1)[1].action,'capture-repeat');
  f.keys.set('other-app-owned',()=>{});f.appState.studioMeetingCompatibility=true;f.floating.refreshShortcuts();
  assert.deepEqual([...f.keys.keys()],['other-app-owned']);
});
