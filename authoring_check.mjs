import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {webcrypto} from 'node:crypto';
import {runInNewContext} from 'node:vm';
import {changedPaths,hashProject,hashRawProject,hashScriptMaskedProject} from './project.mjs';
import {ENTRY_INSTRUCTIONS,GUIDE,registerAuthoringTools} from './authoring-tools.mjs';
import {EntryBrowserBridge} from './bridge_runtime.mjs';

const source=await readFile(new URL('extension/authoring.js',import.meta.url),'utf8');
const clone=v=>JSON.parse(JSON.stringify(v));
let serial=0;
const scene={id:'scene',name:'장면'},scene2={id:'scene2',name:'둘째 장면'};
let openScene=scene;
// ★엔트리처럼 이벤트 머리는 만들어질 때 맨 뒤에 등록되고 load는 스레드 순서로 다시 등록한다. seen은 그때 board가 가리키던 코드·그림 묶음이다.
class Code {
  constructor(data=[]){this.data=clone(data);this.loads=0;this.seen=[];this.heads=new Map();this.events();}
  toJSON(){return clone(this.data);}
  head(t){if(!this.heads.has(t[0]))this.heads.set(t[0],{id:t[0].id,set:p=>Object.assign(t[0],p)});return this.heads.get(t[0]);}
  events(){this._eventMap={when_run_button_click:this.data.filter(t=>t[0].type==='when_run_button_click').map(t=>this.head(t))};}
  note(){const b=this.view?.board;if(b)this.seen.push({code:b.code,group:b.svgThreadGroup});}
  load(data){this.loads++;this.note();this.data=clone(data);this.events();}
  destroyView(){}
  getThreads(){return this.data.map(t=>({getFirstBlock:()=>this.head(t),toJSON:()=>clone(t),destroy:()=>{this.note();this.data.splice(this.data.indexOf(t),1);const list=this._eventMap.when_run_button_click,i=list.indexOf(this.head(t));if(i>=0)list.splice(i,1);}}));}
  createThread(blocks,index){const t=clone(blocks);this.note();this.data.splice(index??this.data.length,0,t);if(t[0].type==='when_run_button_click')this._eventMap.when_run_button_click.push(this.head(t));}
}
class Actor {
  constructor(model){this.id=model.id;this.name=model.name;this.scene=[scene,scene2].find(s=>s.id===model.scene)||openScene;this.objectType='sprite';this.pictures=clone(model.sprite.pictures);this.sounds=clone(model.sprite.sounds||[]);this.selectedPicture=this.pictures[0];this.rotateMethod='free';this.script=new Code(JSON.parse(model.script));
    const e=clone(model.entity);this.entity={getX:()=>e.x,getY:()=>e.y,getScaleX:()=>1,getScaleY:()=>1,getSize:()=>100,
      setX:v=>{e.x=v;if(v===999)actors[1].entity.setY(99);},setY:v=>{e.y=v;},setSize:v=>{e.size=v;},setRotation:v=>{e.rotation=v;},setDirection:v=>{e.direction=v;},setVisible:v=>{e.visible=v;},
      injectModel:(p,m)=>{Object.keys(e).forEach(k=>delete e[k]);Object.assign(e,clone(m));},setImage:p=>{this.entity.picture=p;},getModel:()=>clone(e),picture:this.selectedPicture,visible:true};}
  getPicture(id){return this.pictures.find(p=>p.id===id);}
  setName(n){this.name=n;}
  setRotateMethod(v){this.rotateMethod=v;}
  updateCoordinateView(){}
  generateView(){}
  toJSON(){return {id:this.id,name:this.name,scene:this.scene.id,objectType:'sprite',rotateMethod:this.rotateMethod,script:JSON.stringify(this.script.toJSON()),sprite:{pictures:clone(this.pictures),sounds:clone(this.sounds).map(({path,...s})=>s)},selectedPictureId:this.selectedPicture.id,entity:this.entity.getModel()};}
}
const pic={id:'pic',name:'모양',dimension:{width:10,height:10},filename:'original',fileurl:'/uploads/original.png'};
let actors=['a','b'].map(id=>new Actor({id,name:id,script:JSON.stringify([[{id:'root'+id,type:'when_run_button_click',params:[null],statements:[],x:50,y:100}]]),sprite:{pictures:[pic]},entity:{x:0,y:0,visible:true}}));
const variable=model=>({toJSON:()=>clone(model)});
const vc={variables_:[variable({id:'v',name:'변수',variableType:'variable',value:3})],lists_:[],messages_:[],functions_:{},
  getMessage:id=>vc.messages_.find(m=>m.id===id),addMessage:m=>vc.messages_.unshift(clone(m)),removeMessage:m=>{vc.messages_=vc.messages_.filter(x=>x.id!==m.id);},
  addVariable:m=>vc.variables_.unshift(variable(m)),removeVariable:v=>{vc.variables_=vc.variables_.filter(x=>x!==v);},addList:m=>vc.lists_.unshift(variable(m)),removeList:v=>{vc.lists_=vc.lists_.filter(x=>x!==v);},updateList(){}};
const commands=[];
const Entry={engine:{state:'stop'},scene:{selectedScene:scene,getScenes:()=>[scene],getSceneById:id=>[scene,scene2].find(s=>s.id===id),selectScene(s){openScene=s;this.selectedScene=s;}},playground:{object:actors[0],injectObject(o){this.object=o;},injectPicture(){},injectSound(){}},
  initSound:s=>{s.path=`loaded:${s.filename}`;},
  variableContainer:vc,stateManager:{startIgnore(){},endIgnore(){},get undoStack_(){return commands;},set undoStack_(list){commands.splice(0,commands.length,...list);},addCommand(message,caller,func,...params){const c={message,func,params};commands.push(c);return c;}},
  generateHash:()=>`generated${++serial}`,Utils:{doCodeChange(){}},
  block:{when_run_button_click:{params:[{type:'Indicator'}],statements:[],def:{params:[null]}},
    move_x:{params:[{type:'Block'},{type:'Indicator'}],paramsKeyMap:{VALUE:0},statements:[],def:{params:[10,null]}},
    choice:{params:[{type:'Dropdown',options:[['앞','FRONT'],['뒤','BACK']]}],paramsKeyMap:{LOCATION:0},statements:[],def:{params:['FRONT']}},
    repeat_basic:{params:[{type:'Block'},{type:'Indicator'}],paramsKeyMap:{VALUE:0},statements:[{}],def:{params:[10,null]}}},
  container:{getAllObjects:()=>actors,getCurrentObjects:()=>actors,getObject:id=>actors.find(o=>o.id===id),setCurrentObjects(){},updateListView(){},
    selectObject(id){Entry.playground.object=this.getObject(id);},moveElement(i,j){actors.splice(i,0,actors.splice(j,1)[0]);},addObjectFunc(m,i){delete m.scene;actors.splice(i,0,new Actor(m));},removeObject(id){actors.splice(actors.findIndex(o=>o.id===id),1);if(actors[0])this.selectObject(actors[0].id);}},
  exportProject:()=>({interface:{object:Entry.playground.object?.id??null},objects:actors.map(a=>a.toJSON()),scenes:[scene],variables:[...vc.variables_,...vc.lists_].map(v=>v.toJSON()),messages:vc.messages_.map(m=>({id:m.id,name:m.name})),functions:[],tables:[]})};
Object.defineProperty(Entry.container,'objects_',{get:()=>actors,set:v=>{actors=v;}});
const action=runInNewContext(source+'\nentryAuthoringAction',{Entry,window:{Entry},location:{hostname:'playentry.org',pathname:'/ws/test'},crypto:webcrypto,TextEncoder,Uint8Array,console});
// 에이전트가 읽은 직후 편집하는 경우: 통째로 바꾸는 대상의 버전을 확장과 같은 규칙으로 잰다(문맥 읽기는 되돌림 기록을 소비하므로 쓰지 않는다).
const versionTag=v=>{const t=JSON.stringify(v)??'';let h=2166136261;for(let i=0;i<t.length;i++)h=Math.imul(h^t.charCodeAt(i),16777619);return `${(h>>>0).toString(16)}.${t.length.toString(16)}`;};
const versionOf=key=>{const i=key.indexOf(':'),kind=key.slice(0,i),id=key.slice(i+1);if(kind==='function'){const fn=vc.getFunction?.(id);return fn?versionTag(fn.content.toJSON()):null;}
  const o=actors.find(a=>a.id===id);if(!o)return null;return kind==='script'?versionTag(o.script.toJSON()):versionTag((kind==='pictures'?o.pictures:o.sounds).map(({id,name,filename,fileurl,imageType,dimension,ext,duration})=>[id,name,filename,fileurl,imageType,dimension,ext,duration]));};
const wholeKinds={set_script:'script',set_function:'function',set_pictures:'pictures',set_sounds:'sounds'};
const call=async operations=>{const expectedVersions={};for(const o of operations)if(wholeKinds[o.action]){const key=`${wholeKinds[o.action]}:${o.objectId??o.functionId}`,v=versionOf(key);if(v)expectedVersions[key]=v;}
  return action('edit',{expectedVersions,operations});};
const original=Entry.exportProject();
let result;
for(const block of [{type:'missing',fields:{}},{type:'move_x',fields:{WRONG:10}},{type:'choice',fields:{LOCATION:'UNKNOWN'}}]){
  result=await call([{action:'patch_blocks',objectId:'a',appendThreads:[[block]]}]);assert.ok(result.__entryMcpError);assert.deepEqual(Entry.exportProject(),original);
}
result=await call([{action:'set_object',objectId:'a',properties:{x:10}},{action:'order_objects',objectIds:['a','a']}]);
assert.equal(result.applied,false);assert.equal(result.rolledBack,true);assert.deepEqual(Entry.exportProject(),original);
result=await call([{action:'set_object',objectId:'a',properties:{x:999}}]);
assert.equal(result.applied,false);assert.equal(result.rolledBack,true,'대상 밖의 변경도 복원해야 함');assert.deepEqual(Entry.exportProject(),original);
result=await call([{action:'patch_blocks',objectId:'a',appendThreads:[[{type:'when_run_button_click',fields:{}},{type:'move_x',fields:{VALUE:20}}]]}]);
assert.equal(result.applied,true);assert.equal(result.undoable,true);const code=actors[0].script.toJSON();
assert.equal(code[1][0].params[0],null);assert.equal(code[1][1].params[0],20);assert.equal(code[0][0].id,'roota');assert.deepEqual(actors[1].toJSON(),original.objects[1]);
const read=await action('script',{objectId:'a',offset:0,limit:10,depth:2});assert.equal(read.threadRoots.length,2);
result=await call([{action:'patch_blocks',objectId:'a',patches:[{blockId:code[1][1].id,fields:{VALUE:30}}]}]);assert.equal(result.applied,true);assert.equal(actors[0].script.toJSON()[1][1].params[0],30);
let command=commands.pop();command.func(...command.params);assert.equal(actors[0].script.toJSON()[1][1].params[0],20);
command=commands.pop();command.func(...command.params);assert.equal(actors[0].script.toJSON()[1][1].params[0],30);
// ★되돌리기 항목은 작품 전체 복사본을 붙들므로 수정이 쌓여도 MCP 항목은 하나, 바뀐 게 없으면 없음. 사용자 작업은 지우지 않는다.
const mcpEntries=()=>commands.filter(c=>c.message==='entry-mcp-edit').length,userAction={message:'user-action',func(){},params:[]};
commands.length=0;commands.push(userAction);
result=await call([{action:'set_object',objectId:'a',properties:{x:11}}]);assert.equal(result.undoable,true);assert.equal(mcpEntries(),1);
result=await call([{action:'set_object',objectId:'a',properties:{x:12}}]);assert.equal(mcpEntries(),1,'이전 MCP 항목은 놓아야 함');assert.ok(commands.includes(userAction),'사용자 작업은 남아야 함');
result=await call([{action:'set_object',objectId:'a',properties:{x:12}}]);assert.equal(result.changedCount,0);assert.equal(result.undoable,false);assert.equal(mcpEntries(),1,'바뀐 게 없으면 기록하지 않음');
command=commands.pop();command.func(...command.params);assert.equal(actors[0].entity.getX(),11,'마지막 수정은 되돌아가야 함');
command=commands.pop();command.func(...command.params);assert.equal(actors[0].entity.getX(),12,'되돌린 수정은 다시 할 수 있어야 함');
commands.length=0;
Entry.engine.state='run';result=await call([{action:'set_object',objectId:'a',properties:{x:2}}]);assert.match(result.__entryMcpError,/EDITOR_RUNNING/);Entry.engine.state='stop';
// ★set_function 머리 비교: 읽기 결과는 키 순서가 바뀌어 돌아올 수 있다(실측 2026-10-16: 그대로 다시 보내도 FUNCTION_PARAMETERS_CHANGED).
// 같은 머리를 키 순서만 바꿔 보내면 통과, 머리 내용을 바꾸면 거부돼야 한다.
const header={id:'lbl',x:0,y:0,type:'function_field_label',params:['이름',null],statements:[],movable:null,deletable:1,emphasized:false,readOnly:null,copyable:false,assemble:true,extensions:[]};
const fnThreads=[[{id:'fc',x:50,y:30,type:'function_create',params:[header,null],statements:[[{id:'fb',x:0,y:0,type:'move_x',params:[10,null],statements:[]}]]}]];
const fnCode=new Code(fnThreads);const fn={id:'f1',content:fnCode,generateBlock(){}};
vc.functions_.f1=fn;vc.getFunction=id=>vc.functions_[id];vc.saveFunction=()=>{};
Entry.block.function_create={params:[{type:'Block'},{type:'Indicator'}],statements:[{}],def:{params:[null,null]}};
Entry.block.function_field_label={params:[{type:'TextInput'},{type:'Output'}],statements:[],def:{params:['',null]}};
const sortKeys=v=>Array.isArray(v)?v.map(sortKeys):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,sortKeys(v[k])])):v;
const bodyEdit=t=>{const c=clone(t);c[0][0].statements[0][0].params[0]=40;return c;};
result=await call([{action:'set_function',functionId:'f1',threads:sortKeys(bodyEdit(fnThreads))}]);
assert.ok(!result.__entryMcpError,'키 순서만 다른 같은 머리는 통과해야 함: '+result.__entryMcpError);assert.equal(fnCode.toJSON()[0][0].statements[0][0].params[0],40);
const renamed=bodyEdit(fnThreads);renamed[0][0].params[0].params[0]='다른 이름';
result=await call([{action:'set_function',functionId:'f1',threads:renamed}]);assert.match(result.__entryMcpError,/FUNCTION_PARAMETERS_CHANGED/);
// ★크롬은 확장 인자에서 값이 null인 객체 칸을 빼고 페이지에 넘긴다. 그렇게 온 같은 머리도 통과해야 한다.
const stripNulls=v=>Array.isArray(v)?v.map(stripNulls):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).filter(([,x])=>x!==null).map(([k,x])=>[k,stripNulls(x)])):v;
result=await call([{action:'set_function',functionId:'f1',threads:stripNulls(bodyEdit(fnThreads))}]);
assert.ok(!result.__entryMcpError,'null 칸이 빠진 같은 머리는 통과해야 함: '+result.__entryMcpError);assert.equal(fnCode.toJSON()[0][0].params[0].params[1],null,'배열 안 null은 그대로');
// ★사용자가 그 함수를 편집 화면에 열어 두면 바꾸지 않는다(편집 화면이 깨져 끌어 놓기가 막힘). 다른 함수는 그대로 바꾼다.
Entry.Func={isEdit:true,targetFunc:{id:'f1'}};
const openBefore=JSON.stringify(fnCode.toJSON());
result=await call([{action:'set_function',functionId:'f1',threads:bodyEdit(fnThreads)}]);assert.match(result.__entryMcpError,/FUNCTION_OPEN_IN_EDITOR/);assert.equal(JSON.stringify(fnCode.toJSON()),openBefore,'열린 함수는 그대로여야 함');
result=await call([{action:'remove_function',functionId:'f1'}]);assert.match(result.__entryMcpError,/FUNCTION_OPEN_IN_EDITOR/);assert.ok(vc.functions_.f1);
Entry.Func={isEdit:false};
result=await call([{action:'set_function',functionId:'f1',threads:sortKeys(bodyEdit(fnThreads))}]);assert.ok(!result.__entryMcpError,'편집 화면을 닫으면 다시 바꿀 수 있어야 함: '+result.__entryMcpError);
// ★create_function: 원형 칸 블록 종류는 함수가 생기기 전엔 Entry.block에 없으므로 머리에서 선언된 것만 허용하고, 실패하면 만든 함수도 지운다.
let menuRegistrations=0;
Entry.Func=class{constructor(m){this.id=m.id;this.model=m;this.content=new Code(JSON.parse(m.content));Entry.Func.registerFunction(this);}generateBlock(){}static registerFunction(){menuRegistrations++;}static updateMenu(){}};
vc.saveFunction=f=>{vc.functions_[f.id]=f;};vc.removeFunction=f=>{delete vc.functions_[f.id];};
Entry.block.function_field_string={params:[{type:'Block'},{type:'Output'}],statements:[],def:{params:[null,null]}};
Entry.block.get_func_variable={params:[{type:'DropdownDynamic'},{type:'Indicator'}],statements:[],def:{params:[null,null]}};
const newHead={type:'function_create',params:[{type:'function_field_label',params:['움직이기',{type:'function_field_string',params:[{type:'stringParam_tx'},null]}]},null],
  statements:[[{type:'move_x',params:[{type:'stringParam_tx'},null]},{type:'move_x',params:[{type:'get_func_variable',params:['lv1',null]},null]}]]};
// ★실제 엔트리는 지역 변수 id의 첫 '_' 앞을 함수 id로 찾는다 — 정상 사례도 '<함수 id>_<접미>'여야 한다.
const headFor=(id,localId=`${id}_lv1`)=>{const h=clone(newHead);h.statements[0][1].params[0].params[0]=localId;return h;};
const create=(id,head=headFor(id),locals=[{id:`${id}_lv1`,name:'출발 x',value:0}])=>call([{action:'create_function',model:{id,type:'normal',localVariables:locals,threads:[[head]]}}]);
result=await create('tc_text');assert.match(result.__entryMcpError,/FUNCTION_ID_UNDERSCORE/);assert.ok(!vc.functions_.tc_text);
result=await create('fwrong',headFor('fwrong','lv1'),[{id:'lv1',name:'출발 x',value:0}]);assert.match(result.__entryMcpError,/LOCAL_VARIABLE_ID_FORMAT/);assert.ok(!vc.functions_.fwrong);
result=await create('fnew');assert.equal(result.applied,true,JSON.stringify(result));assert.equal(menuRegistrations,1,'블록 메뉴에는 한 번만 등록돼야 함');assert.ok(vc.functions_.fnew);assert.equal(vc.functions_.fnew.model.useLocalVariables,true);
assert.equal(vc.functions_.fnew.content.toJSON()[0][0].statements[0][0].params[0].type,'stringParam_tx');
result=await create('fnew');assert.match(result.__entryMcpError,/FUNCTION_ID_EXISTS/);
result=await create('fbad',headFor('fbad'),[]);assert.match(result.__entryMcpError,/LOCAL_VARIABLE_NOT_DECLARED/);assert.ok(!vc.functions_.fbad);
const strayHead=headFor('fstray');strayHead.statements[0][0].params[0].type='stringParam_undeclared';
result=await create('fstray',strayHead);assert.match(result.__entryMcpError,/UNKNOWN_BLOCK_TYPE/);assert.ok(!vc.functions_.fstray);
result=await call([{action:'create_function',model:{id:'froll',localVariables:[{id:'froll_lv1',name:'출발 x'}],threads:[[headFor('froll')]]}},{action:'order_objects',objectIds:['a','a']}]);
assert.equal(result.applied,false);assert.ok(!vc.functions_.froll,'실패한 묶음에서 만든 함수는 지워져야 함');
// ★remove_function: 아직 부르는 곳이 있으면 거부, 부르는 곳과 함께 지우면 통과, 실패한 묶음에서 지운 함수는 되살린다.
Entry.block.func_fnew={params:[{type:'Block'},{type:'Indicator'}],statements:[],def:{params:[null,null]}};
result=await call([{action:'patch_blocks',objectId:'a',appendThreads:[[{id:'fcallroot',type:'when_run_button_click',params:[null]},{type:'func_fnew',params:[null,null]}]]}]);assert.equal(result.applied,true,JSON.stringify(result));
result=await call([{action:'remove_function',functionId:'fnew'}]);assert.equal(result.applied,false);assert.match(String(result.error),/STILL_IN_USE: func_fnew/);assert.ok(vc.functions_.fnew,'거부되면 함수가 남아 있어야 함');
result=await call([{action:'remove_function',functionId:'nope'}]);assert.match(result.__entryMcpError,/FUNCTION_NOT_FOUND/);
result=await call([{action:'remove_threads',objectId:'a',threadIds:['fcallroot']},{action:'remove_function',functionId:'fnew'}]);assert.equal(result.applied,true,JSON.stringify(result));assert.ok(!vc.functions_.fnew);
result=await create('fkeep');assert.equal(result.applied,true,JSON.stringify(result));
result=await call([{action:'remove_function',functionId:'fkeep'},{action:'order_objects',objectIds:['a','a']}]);
assert.equal(result.applied,false);assert.ok(vc.functions_.fkeep,'실패한 묶음에서 지운 함수는 되살아나야 함');assert.equal(vc.functions_.fkeep.content.toJSON()[0][0].type,'function_create');
// ★지우기 3종: 아직 쓰이는 신호는 거부하고 원상 복구, 묶음과 함께 지우면 통과, 없는 묶음은 거부.
result=await call([{action:'upsert_message',id:'m1',name:'신호'},{action:'patch_blocks',objectId:'a',appendThreads:[[{type:'when_run_button_click',fields:{}},{type:'move_x',fields:{VALUE:'m1'}}]]}]);
assert.equal(result.applied,true,JSON.stringify(result));const usedRoot=actors[0].script.toJSON().at(-1)[0].id;const snapshot=Entry.exportProject();
result=await call([{action:'remove_message',id:'m1'}]);assert.equal(result.applied,false);assert.match(String(result.error),/STILL_IN_USE/);assert.deepEqual(Entry.exportProject(),snapshot);
result=await call([{action:'remove_threads',objectId:'a',threadIds:['nope']}]);assert.match(result.__entryMcpError,/THREAD_NOT_FOUND/);assert.deepEqual(Entry.exportProject(),snapshot);
result=await call([{action:'remove_threads',objectId:'a',threadIds:[usedRoot]},{action:'remove_message',id:'m1'}]);
assert.equal(result.applied,true,JSON.stringify(result));assert.ok(!vc.getMessage('m1'));assert.ok(!actors[0].script.toJSON().some(t=>t[0].id===usedRoot));assert.equal(actors[0].script.toJSON()[0][0].id,'roota');
result=await call([{action:'remove_variable',id:'v'}]);assert.equal(result.applied,true,JSON.stringify(result));assert.ok(!vc.variables_.some(v=>v.toJSON().id==='v'));
// ★소리 목록: 새 소리 추가, 길이 0 소리 거부, 블록이 아직 쓰는 소리를 지우면 거부하고 원상 복구.
const snd={id:'s1',name:'음악.mp3',filename:'abc',ext:'.mp3',duration:3.5};
result=await call([{action:'set_sounds',objectId:'a',sounds:[snd]}]);assert.equal(result.applied,true,JSON.stringify(result));
assert.deepEqual(Entry.exportProject().objects.find(o=>o.id==='a').sprite.sounds,[snd]);assert.equal(actors[0].sounds[0].path,'loaded:abc');
result=await call([{action:'set_sounds',objectId:'a',sounds:[{...snd,id:'s2',duration:0}]}]);assert.match(result.__entryMcpError,/SOUND_MODEL_INVALID/);
result=await call([{action:'patch_blocks',objectId:'a',appendThreads:[[{type:'when_run_button_click',fields:{}},{type:'move_x',fields:{VALUE:'s1'}}]]}]);assert.equal(result.applied,true,JSON.stringify(result));
const withSound=Entry.exportProject();
result=await call([{action:'set_sounds',objectId:'a',sounds:[]}]);assert.equal(result.applied,false);assert.match(String(result.error),/STILL_IN_USE: s1/);assert.deepEqual(Entry.exportProject(),withSound);
result=await call([{action:'set_sounds',objectId:'a',sounds:[snd,{...snd,id:'s3',name:'반복.mp3',filename:'def'}]}]);assert.equal(result.applied,true,JSON.stringify(result));assert.equal(actors[0].sounds.length,2);
const registrations=[];registerAuthoringTools({registerTool:(name,definition)=>registrations.push({name,...definition})},{bridge:{},guarded:fn=>fn});
for(const name of ['entry_help','entry_context','entry_script','entry_edit','entry_control','entry_state','entry_preview','entry_upload_asset','entry_upload_sound'])assert.ok(registrations.some(t=>t.name===name));
assert.ok(registrations.find(t=>t.name==='entry_edit').inputSchema.safeParse({operations:[{action:'set_sounds',objectId:'a',sounds:[]}]}).success);
assert.match(ENTRY_INSTRUCTIONS,/No Entry source code/);assert.ok(GUIDE.examples.changeOneInput);assert.ok(GUIDE.recovery.TARGET_CHANGED&&GUIDE.recovery.VERSION_REQUIRED&&!GUIDE.recovery.STALE_PROJECT_HASH);assert.ok(GUIDE.examples.replaceScript.expectedVersions);
assert.ok(registrations.find(t=>t.name==='entry_edit').inputSchema.safeParse({operations:GUIDE.examples.addMovementThread.operations}).success);
assert.ok(registrations.find(t=>t.name==='entry_edit').inputSchema.safeParse({operations:[{action:'remove_threads',objectId:'a',threadIds:['r']},{action:'remove_variable',id:'v'},{action:'remove_message',id:'m'}]}).success);
// ★EntryRoot 저장 변환처럼 내보낼 때마다 zs_ 블록 id가 새로 붙어도 같은 작품으로 보고 편집해야 한다. 대상 밖의 실제 변경은 계속 거부한다.
const plainExport=Entry.exportProject;let zs=0;
Entry.exportProject=()=>{const p=plainExport();p.objects[1].script=JSON.stringify([[{id:`zs_${(zs++).toString(36)}`,type:'when_run_button_click',params:[null],statements:[],x:0,y:0}]]);
  p.functions=[{id:'lowered',content:JSON.stringify([[{id:`zcolzs_${(zs++).toString(36)}`,type:'text',params:['1'],statements:[]}]])}];return p;};
const driftA=Entry.exportProject(),driftB=Entry.exportProject();
assert.notEqual(driftA.objects[1].script,driftB.objects[1].script);assert.equal(hashProject(driftA),hashProject(driftB));assert.deepEqual(changedPaths(driftA,driftB),[]);
const infoA={variables:[{id:'erinfo',variableType:'list',array:[{data:'[["s","p","zs_1","zs_0"]]'}]}]},infoB=clone(infoA);infoB.variables[0].array[0].data='[["s","p","zs_9","zs_8"]]';
assert.equal(hashProject(infoA),hashProject(infoB));const userValue=clone(infoA);userValue.variables[0].array[0].data='사용자 값';assert.notEqual(hashProject(userValue),hashProject(infoA));
const realChange=clone(driftB);realChange.objects[1].name='다른 이름';assert.notEqual(hashProject(realChange),hashProject(driftB));assert.deepEqual(changedPaths(driftB,realChange),['/objects/1/name']);
result=await call([{action:'set_object',objectId:'a',properties:{x:5}}]);assert.equal(result.applied,true,JSON.stringify(result));
result=await call([{action:'set_object',objectId:'a',properties:{x:999}}]);assert.equal(result.applied,false);assert.equal(result.rolledBack,true);
Entry.exportProject=plainExport;
// ★EntryRoot 저장 변환은 내보낼 때만 생기는 리스트(편집기에 없는 변수)에 신호 목록을 적는다.
//   신호를 더해도 그 리스트 변화는 대상 밖 변경이 아니고, 편집기 변수의 실제 변경은 계속 거부한다.
Entry.exportProject=()=>{const p=plainExport();p.variables.push({id:'erinfo',name:'EntryRoot 편집 정보',variableType:'list',array:[{data:JSON.stringify({mseq:p.messages.map(m=>m.id)})}]});return p;};
result=await call([{action:'upsert_message',id:'m2',name:'신호 2'}]);assert.equal(result.applied,true,JSON.stringify(result));
const plainAdd=vc.addMessage;vc.addMessage=m=>{plainAdd(m);vc.variables_.push(variable({id:'side',name:'옆 변수',variableType:'variable',value:1}));};
result=await call([{action:'upsert_message',id:'m3',name:'신호 3'}]);assert.equal(result.applied,false);assert.equal(JSON.stringify(result.unexpectedChanges),'["variables outside operations"]');
vc.addMessage=plainAdd;vc.variables_=vc.variables_.filter(v=>v.toJSON().id!=='side');Entry.exportProject=plainExport;
assert.equal(hashRawProject(original),hashProject(original),'zs_ id가 없는 작품은 예전 체크포인트 해시와 같아야 함');assert.notEqual(hashRawProject(driftA),hashProject(driftA));
assert.ok((await readFile(new URL('extension/authoring.js',import.meta.url),'utf8')).includes(String.raw`/"(zcol)?zs_[0-9a-z]+"/g`),'authoring.js: project.mjs와 같은 zs_ 규칙');
// ★이름 바꾸기도 사용자와 동시에 쓸 수 있게 작품 전체 해시 조건을 두지 않는다. 확장에 해시 규칙을 따로 만들지 않는다.
{const bg=await readFile(new URL('extension/background.js',import.meta.url),'utf8');assert.ok(!bg.includes('crypto.subtle.digest')&&!bg.includes('STALE_PROJECT_HASH')&&!bg.includes('expectedHash'),'background.js: 이름 바꾸기에 작품 전체 해시 조건 없음');}
const byId=id=>actors.find(a=>a.id===id);
// ★실시간 합작 모델: 바뀌었다는 신호가 있어야 다시 읽고, 나머지는 캐시를 쓴다. 다른 사람이 오브젝트를 더하면 캐시로 작품을 다시 불러온다.
const roomCache={code:new Map(),messages:[],variables:[]};let roomDirty=false;
const readRoom=()=>{roomCache.code=new Map(actors.map(a=>[a.id,a.script.toJSON()]));roomCache.messages=clone(vc.messages_);roomCache.variables=vc.variables_.slice();roomDirty=false;};
const realAddCommand=Entry.stateManager.addCommand;
Entry.commander={doEvent:{notify(){roomDirty=true;}}};
Entry.stateManager.addCommand=function(...args){if(roomDirty)readRoom();else {const o=Entry.playground.object;roomCache.code.set(o.id,o.script.toJSON());}return realAddCommand.apply(this,args);};
const reloadFromRoom=()=>{for(const a of actors)a.script.load(roomCache.code.get(a.id)||[]);vc.messages_=clone(roomCache.messages);vc.variables_=roomCache.variables.slice();};
readRoom();assert.equal(Entry.playground.object.id,'a');
result=await call([{action:'upsert_message',id:'roomm',name:'합작 신호'},{action:'upsert_variable',model:{id:'roomv',name:'합작 변수',variableType:'variable'}},{action:'patch_blocks',objectId:'b',appendThreads:[[{id:'roomt',type:'when_run_button_click',fields:{}}]]}]);
assert.equal(result.applied,true,JSON.stringify(result));reloadFromRoom();
assert.ok(vc.getMessage('roomm'),'합작 재불러오기 뒤에도 신호가 남아야 함');assert.ok(vc.variables_.some(v=>v.toJSON().id==='roomv'),'변수가 남아야 함');assert.ok(byId('b').script.toJSON().some(t=>t[0].id==='roomt'),'선택 안 된 오브젝트의 스레드가 남아야 함');
Entry.stateManager.addCommand=realAddCommand;delete Entry.commander;
// ★적용 뒤 사라진 편집은 다음 호출에서 한 번 알리고, Ctrl+Z와 외부 원인을 구분한다. 에이전트가 직접 되돌린 값은 알리지 않는다.
result=await call([{action:'upsert_message',id:'gone',name:'사라질 신호'},{action:'patch_blocks',objectId:'b',appendThreads:[[{id:'gonet',type:'when_run_button_click',fields:{}}]]}]);assert.equal(result.applied,true,JSON.stringify(result));
const goneHash=result.afterHash;vc.messages_=vc.messages_.filter(m=>m.id!=='gone');byId('b').script.load(byId('b').script.toJSON().filter(t=>t[0].id!=='gonet'));
let ctx=await action('context',{});assert.equal(ctx.revertedEdits.length,1);assert.equal(ctx.revertedEdits[0].cause,'external');assert.equal(ctx.revertedEdits[0].afterHash,goneHash);
assert.deepEqual(clone(ctx.revertedEdits[0].items.map(i=>[i.kind,i.id,i.state]).sort()),[['message','gone','missing'],['object','b','reverted']]);
assert.equal((await action('context',{})).revertedEdits.length,0,'같은 알림을 반복하지 않음');
result=await call([{action:'upsert_message',id:'undone',name:'되돌릴 신호'}]);command=commands.pop();command.func(...command.params);ctx=await action('context',{});assert.equal(ctx.revertedEdits[0].cause,'undo');assert.equal(ctx.revertedEdits[0].items[0].state,'missing');
const homeX=byId('a').entity.getX();result=await call([{action:'set_object',objectId:'a',properties:{x:31}}]);assert.equal(result.applied,true);result=await call([{action:'set_object',objectId:'a',properties:{x:homeX}}]);assert.equal(result.revertedEdits.length,0);assert.equal((await action('context',{})).revertedEdits.length,0,'에이전트가 직접 되돌린 값은 알리지 않음');
result=await call([{action:'upsert_message',id:'chk',name:'체크포인트용'}]);vc.messages_=vc.messages_.filter(m=>m.id!=='chk');assert.equal((await action('journal',{})).revertedEdits.length,1);
// ★되돌리기는 편집 대상만 바꾼다. 그사이 다른 곳에 생긴 변경을 옛 내용으로 덮지 않는다.
result=await call([{action:'set_object',objectId:'a',properties:{x:77}}]);byId('b').entity.setX(55);command=commands.pop();command.func(...command.params);assert.equal(byId('a').entity.getX(),homeX);assert.equal(byId('b').entity.getX(),55,'대상 밖 변경은 남아야 함');
// ★블록 id는 코드 하나 안에서만 구분한다: 복사 오브젝트끼리 같아도 통과, 오브젝트 안에 이미 있던 겹침은 보존, 새로 생기는 겹침만 거부.
const sharedThread=[{id:'shared',type:'when_run_button_click',params:[null],statements:[]}];
for(const id of ['a','b'])byId(id).script.load([...byId(id).script.toJSON(),sharedThread]);
result=await call([{action:'patch_blocks',objectId:'a',patches:[]},{action:'patch_blocks',objectId:'b',patches:[]}]);assert.equal(result.applied,true,JSON.stringify(result));
byId('a').script.load([...byId('a').script.toJSON(),[{id:'twice',type:'when_run_button_click',params:[null],statements:[]}],[{id:'twice',type:'when_run_button_click',params:[null],statements:[]}]]);
result=await call([{action:'patch_blocks',objectId:'a',patches:[]}]);assert.equal(result.applied,true,'이미 있던 겹침은 편집을 막지 않음: '+JSON.stringify(result));
result=await call([{action:'patch_blocks',objectId:'a',appendThreads:[[{id:'twice',type:'when_run_button_click',fields:{}}]]}]);assert.match(result.__entryMcpError,/DUPLICATE_BLOCK_ID: twice/);
result=await call([{action:'patch_blocks',objectId:'a',appendThreads:[[{id:'fresh',type:'when_run_button_click',fields:{}}],[{id:'fresh',type:'when_run_button_click',fields:{}}]]}]);assert.match(result.__entryMcpError,/DUPLICATE_BLOCK_ID: fresh/);
// ★한 묶음에서 같은 오브젝트를 여러 번 고치면 앞 작업이 사라지지 않는다.
result=await call([{action:'remove_threads',objectId:'a',threadIds:['shared']},{action:'patch_blocks',objectId:'a',appendThreads:[[{id:'after',type:'when_run_button_click',fields:{}}]]}]);assert.equal(result.applied,true,JSON.stringify(result));
assert.ok(!byId('a').script.toJSON().some(t=>t[0].id==='shared'),'앞 작업(지우기)이 남아야 함');assert.ok(byId('a').script.toJSON().some(t=>t[0].id==='after'),'뒤 작업(더하기)도 남아야 함');
// ★칸 수: def.params가 정의보다 길거나 짧은 블록은 저장 모양으로 맞추고, 정말 틀린 칸 수는 계속 거부한다.
Entry.block.text_read={params:[{type:'DropdownDynamic'}],paramsKeyMap:{VALUE:0},statements:[],def:{params:[null,null],type:'text_read'}};
Entry.block.number={params:[{type:'TextInput'}],statements:[],def:{params:[]}};
Entry.block.calc_short={params:[{type:'Block'},{type:'Dropdown',value:'PLUS',options:[['더하기','PLUS']]},{type:'Block'}],paramsKeyMap:{LEFT:0,OP:1,RIGHT:2},statements:[],def:{params:[{type:'number',params:[10]}]}};
const paramsOf=async block=>{const r=await call([{action:'patch_blocks',objectId:'a',appendThreads:[[{type:'when_run_button_click',fields:{}},block]]}]);return r.applied?byId('a').script.toJSON().at(-1)[1].params:r.__entryMcpError||r.error;};
assert.deepEqual(await paramsOf({type:'text_read'}),[null]);assert.deepEqual(await paramsOf({type:'text_read',params:['self',null]}),['self']);
assert.match(await paramsOf({type:'text_read',params:['self','x']}),/BLOCK_PARAM_COUNT: text_read requires 1/);assert.match(await paramsOf({type:'text_read',params:[]}),/BLOCK_PARAM_COUNT/);
assert.equal((await paramsOf({type:'calc_short'})).length,3);assert.equal((await paramsOf({type:'calc_short'}))[1],'PLUS');
// ★값 칸의 0·''·false는 엔트리가 기본값 블록으로 바꾸므로 칸의 기본 블록 모양으로 감싸 넣는다(숫자 0이 10으로 들어가던 결함)
Entry.block.text={params:[{type:'TextInput'}],statements:[],def:{params:[]},isPrimitive:true};Entry.block.number.isPrimitive=true;
Entry.block.set_short={params:[{type:'Block'}],paramsKeyMap:{VALUE:0},statements:[],def:{params:[{type:'text',params:['10']}]}};
{const zero=(await paramsOf({type:'calc_short',fields:{RIGHT:0}}))[2];assert.equal(zero?.type,'number');assert.deepEqual(zero.params,[0]);
 const text=(await paramsOf({type:'set_short',fields:{VALUE:0}}))[0];assert.equal(text?.type,'text');assert.deepEqual(text.params,['0']);
 assert.deepEqual((await paramsOf({type:'set_short',params:['']}))[0].params,['']);assert.equal((await paramsOf({type:'calc_short',params:[5,'PLUS',7]}))[0],5,'참인 날값은 예전처럼 엔트리가 감싼다');}
// ★바뀌지 않은 스레드는 다시 재지 않는다: 없는 함수를 부르는 스레드와 저장 모양이 다른 블록이 있어도 다른 곳은 고칠 수 있고, 그 스레드를 바꿀 때는 검사한다.
const brokenThread=[{id:'broken',type:'func_missing',params:[],statements:[]}],oldShape=[{id:'oldshape',type:'text_read',params:['self',null],statements:[]}];
byId('a').script.load([...byId('a').script.toJSON(),brokenThread,oldShape]);
result=await call([{action:'patch_blocks',objectId:'a',appendThreads:[[{id:'besides',type:'when_run_button_click',fields:{}}]]}]);assert.equal(result.applied,true,JSON.stringify(result));
assert.deepEqual(byId('a').script.toJSON().find(t=>t[0].id==='oldshape')[0].params,['self',null],'건드리지 않은 블록은 모양도 그대로');
result=await call([{action:'patch_blocks',objectId:'a',patches:[{blockId:'oldshape',fields:{VALUE:'other'}}]}]);assert.equal(result.applied,true,JSON.stringify(result));assert.deepEqual(byId('a').script.toJSON().find(t=>t[0].id==='oldshape')[0].params,['other'],'고친 블록은 저장 모양으로');
result=await call([{action:'patch_blocks',objectId:'a',appendThreads:[[{id:'broken',type:'when_run_button_click',fields:{}}]]}]);assert.match(result.__entryMcpError,/DUPLICATE_BLOCK_ID: broken/,'검사를 건너뛴 스레드의 id도 겹침 판정에 든다');
const brokenEdit=clone(byId('a').script.toJSON());brokenEdit.find(t=>t[0].id==='broken').push({type:'move_x',fields:{VALUE:1}});result=await call([{action:'set_script',objectId:'a',threads:brokenEdit}]);assert.match(result.__entryMcpError,/UNKNOWN_BLOCK_TYPE: func_missing/,'바꾼 스레드는 검사한다');
result=await call([{action:'set_script',objectId:'a',threads:sortKeys(byId('a').script.toJSON())}]);assert.equal(result.applied,true,'키 순서만 다른 끊긴 스레드는 그대로로 본다: '+JSON.stringify(result));
result=await call([{action:'remove_threads',objectId:'a',threadIds:['broken','oldshape']}]);assert.equal(result.applied,true,JSON.stringify(result));
// ★다른 장면 오브젝트도 지울 수 있고, 되돌리면 그 장면으로 돌아오며, 실패한 묶음에서도 복구된다. 보던 장면은 어느 쪽도 바뀌지 않는다.
Entry.EntryObject=Actor;actors.push(new Actor({id:'far',name:'먼 오브젝트',scene:'scene2',script:'[]',sprite:{pictures:[pic]},entity:{x:5,y:5,visible:true}}));
result=await call([{action:'remove_object',objectId:'far'},{action:'order_objects',objectIds:['a','a']}]);assert.equal(result.applied,false);assert.equal(result.rolledBack,true,JSON.stringify(result));assert.equal(byId('far').scene.id,'scene2');
// ★실패한 묶음의 복구는 일부 실행된 뒤의 화면이 아니라 편집 시작 때의 화면으로 돌아간다.
const spare=new Actor({id:'spare',name:'지워질 것',script:'[]',sprite:{pictures:[pic]},entity:{x:1,y:1,visible:true}});actors.push(spare);Entry.container.selectObject('b');
result=await call([{action:'remove_object',objectId:'spare'},{action:'order_objects',objectIds:['a','a']}]);assert.equal(result.applied,false);assert.equal(result.rolledBack,true,'선택이 돌아와야 해시도 같다: '+JSON.stringify(result));assert.equal(Entry.playground.object.id,'b');
// ★선택 중인 오브젝트를 지우면 선택이 옮겨 가는 것은 대상 밖 변경이 아니다.
Entry.container.selectObject('spare');result=await call([{action:'remove_object',objectId:'spare'}]);assert.equal(result.applied,true,JSON.stringify(result));assert.ok(!byId('spare'));Entry.container.selectObject('a');
result=await call([{action:'remove_object',objectId:'far'}]);assert.equal(result.applied,true,JSON.stringify(result));assert.ok(!byId('far'));assert.equal(Entry.scene.selectedScene.id,'scene');
command=commands.pop();command.func(...command.params);assert.equal(byId('far').scene.id,'scene2','되돌리면 원래 장면으로');assert.equal(Entry.scene.selectedScene.id,'scene');
// ★지역 변수를 넣으면 엔트리가 주인 오브젝트의 장면으로 옮긴다. 편집이 끝나면 사용자가 보던 장면으로 돌아와야 한다.
const plainAddVariable=vc.addVariable;vc.select=o=>{vc.selected=vc.selected===o?null:o;};vc.addVariable=m=>{plainAddVariable(m);if(m.object){vc.selected={object_:m.object};Entry.scene.selectScene(scene2);}};
result=await call([{action:'upsert_variable',model:{id:'localv',name:'지역 변수',variableType:'variable',object:'far'}}]);assert.equal(result.applied,true,JSON.stringify(result));assert.equal(Entry.scene.selectedScene.id,'scene','보던 장면 유지');assert.ok(!vc.selected,'선택이 남으면 목록을 그릴 때 다시 장면을 옮김');
result=await call([{action:'upsert_variable',model:{id:'localw',name:'지역 변수 2',variableType:'variable',object:'far'}},{action:'add_object',id:'here',name:'여기',templateObjectId:'a'}]);assert.equal(result.applied,true,JSON.stringify(result));assert.equal(byId('here').scene.id,'scene','같은 묶음의 새 오브젝트는 보던 장면에 들어가야 함');
vc.addVariable=plainAddVariable;
const plainSelectScene=Entry.scene.selectScene;Entry.scene.selectScene=()=>{};result=await action('control',{action:'select_scene',sceneId:'scene2'});assert.match(result.__entryMcpError,/SCENE_NOT_CHANGED/,'엔트리가 전환을 건너뛰면 성공으로 보고하지 않음');Entry.scene.selectScene=plainSelectScene;
result=await action('control',{action:'select_scene',sceneId:'scene2'});assert.equal(result.sceneId,'scene2');result=await action('control',{action:'select_scene',sceneId:'nope'});assert.match(result.__entryMcpError,/SCENE_NOT_FOUND/);
Entry.engine.state='run';result=await action('control',{action:'select_scene',sceneId:'scene'});assert.match(result.__entryMcpError,/EDITOR_RUNNING/);Entry.engine.state='stop';await action('control',{action:'select_scene',sceneId:'scene'});
const control=registrations.find(t=>t.name==='entry_control').inputSchema;assert.ok(control.safeParse({action:'select_scene',sceneId:'s'}).success);assert.ok(!control.safeParse({action:'select_scene'}).success);assert.ok(GUIDE.recovery.revertedEdits);
// ★표의 updated·행 key는 다시 불러올 때만 바뀌는 값이다. 해시와 변경 경로에서 빼되 내용 변경은 잡고, 규칙 이전 체크포인트 이름도 계속 받는다.
const withTable=mark=>({objects:[],tables:[{id:'t',updated:mark,data:[{key:`k${mark}`,value:['1']}]}]});
assert.equal(hashProject(withTable('a')),hashProject(withTable('b')));assert.deepEqual(changedPaths(withTable('a'),withTable('b')),[]);
const newCell=withTable('a');newCell.tables[0].data[0].value=['2'];assert.notEqual(hashProject(newCell),hashProject(withTable('a')));assert.deepEqual(changedPaths(withTable('a'),newCell),['/tables/0/data/0/value/0']);
const newRow=withTable('a');newRow.tables[0].data.push({key:'x',value:['1']});assert.notEqual(hashProject(newRow),hashProject(withTable('a')));
assert.notEqual(hashScriptMaskedProject(withTable('a')),hashProject(withTable('a')));assert.equal(hashScriptMaskedProject(original),hashProject(original));
Entry.exportProject=()=>({...plainExport(),tables:[{id:'t',updated:`u${serial++}`,data:[{key:`k${serial++}`,value:['1']}]}]});
const tableA=await action('hash',{}),tableB=await action('hash',{});assert.equal(tableA.hash,tableB.hash,'확장 해시도 같은 규칙');assert.equal(tableA.hash,hashProject(Entry.exportProject()),'확장과 서버 해시가 같아야 함');
result=await call([{action:'set_object',objectId:'a',properties:{x:44}}]);assert.equal(result.applied,true,JSON.stringify(result));Entry.exportProject=plainExport;
// ★insert_blocks: 기존 블록 앞뒤(반복 칸 안 포함)에 끼우고, 시작 블록 앞·없는 id·틀린 블록은 작품을 그대로 두고 거절한다.
result=await call([{action:'patch_blocks',objectId:'b',appendThreads:[[{id:'insroot',type:'when_run_button_click',fields:{}},
  {id:'insloop',type:'repeat_basic',fields:{VALUE:3},statements:[[{id:'insinner',type:'move_x',fields:{VALUE:1}}]]}]]}]);
assert.equal(result.applied,true,JSON.stringify(result));
const insertThread=()=>actors.find(o=>o.id==='b').script.toJSON().find(t=>t[0].id==='insroot');
result=await call([{action:'insert_blocks',objectId:'b',inserts:[{afterBlockId:'insinner',blocks:[{id:'insafter',type:'move_x',fields:{VALUE:2}}]},
  {beforeBlockId:'insloop',blocks:[{id:'insbefore',type:'move_x',fields:{VALUE:5}}]}]}]);
assert.equal(result.applied,true,JSON.stringify(result));
assert.deepEqual(insertThread().map(b=>b.id),['insroot','insbefore','insloop']);
assert.deepEqual(insertThread()[2].statements[0].map(b=>[b.id,b.params[0]]),[['insinner',1],['insafter',2]]);
const afterInsert=Entry.exportProject();
for(const [insert,error] of [[{beforeBlockId:'insroot',blocks:[{type:'move_x',fields:{VALUE:1}}]},/CANNOT_INSERT_BEFORE_THREAD_HEAD/],
  [{afterBlockId:'nothere',blocks:[{type:'move_x',fields:{VALUE:1}}]},/BLOCK_NOT_IN_STACK/],
  [{afterBlockId:'insinner',blocks:[{type:'move_x',fields:{WRONG:1}}]},/UNKNOWN_BLOCK_FIELD/]]){
  result=await call([{action:'insert_blocks',objectId:'b',inserts:[insert]}]);assert.match(String(result.__entryMcpError),error);assert.deepEqual(Entry.exportProject(),afterInsert);}
const edit=registrations.find(t=>t.name==='entry_edit').inputSchema;
assert.ok(edit.safeParse({operations:GUIDE.examples.insertAfterBlock.operations}).success);
assert.ok(!edit.safeParse({operations:[{action:'insert_blocks',objectId:'b',inserts:[{afterBlockId:'x',beforeBlockId:'y',blocks:[{type:'move_x'}]}]}]}).success);
// ★operationsPath: 파일의 목록도 같은 검사를 거쳐 그대로 확장에 간다. 둘 다·둘 다 없음·상대 경로·틀린 동작은 거절한다.
assert.ok(edit.safeParse({operationsPath:'C:/x/ops.json'}).success);
assert.ok(!edit.safeParse({operations:GUIDE.examples.insertAfterBlock.operations,operationsPath:'C:/x/ops.json'}).success);
assert.ok(!edit.safeParse({}).success);
{
  const tools=[];let sent=null;const empty={objects:[]};
  registerAuthoringTools({registerTool:(name,definition,handler)=>tools.push({name,handler})},
    {bridge:{request:async(method,args)=>{sent={method,args};return {applied:true};}},guarded:fn=>fn,project:async()=>empty,checkpoint:async()=>'backup'});
  const handler=tools.find(t=>t.name==='entry_edit').handler,dir=await mkdtemp(join(tmpdir(),'entry-ops-'));
  const ops=[{action:'set_pictures',objectId:'a',pictures:[{id:'p1',name:'모양'}],selectedPictureId:'p1'}];
  await writeFile(join(dir,'ops.json'),JSON.stringify(ops));
  const passed=await handler({operationsPath:join(dir,'ops.json')});
  const {requestId:sentId,...sentArgs}=sent.args;assert.equal(passed.status,'PASS');assert.match(sentId,/^[0-9a-f-]{36}$/);assert.equal(passed.requestId,sentId);
  assert.deepEqual({method:sent.method,args:sentArgs},{method:'edit',args:{operations:ops}});
  await assert.rejects(handler({operationsPath:'ops.json'}),/ABSOLUTE_OPERATIONS_PATH_REQUIRED/);
  await writeFile(join(dir,'bad.json'),JSON.stringify([{action:'not_real'}]));sent=null;
  await assert.rejects(handler({operationsPath:join(dir,'bad.json')}));assert.equal(sent,null,'틀린 파일은 확장에 보내지 않음');
}
// ★스크립트 편집은 바뀐 스레드만 빼고 넣는다. 바뀌지 않은 스레드는 그대로 두고, 맞출 수 없을 때만 통째로 다시 불러온다.
{
  result=await call([{action:'remove_threads',objectId:'a',threadIds:['twice']}]);assert.equal(result.applied,true,JSON.stringify(result));
  const s=byId('a').script,start=s.loads,first=s.data[0],order=()=>s.data.map(t=>t[0].id);
  result=await call([{action:'patch_blocks',objectId:'a',appendThreads:[[{id:'inc1',type:'when_run_button_click',fields:{}},{id:'inc1m',type:'move_x',fields:{VALUE:1}}],[{id:'inc2',type:'when_run_button_click',fields:{}}]]}]);
  assert.equal(result.applied,true,JSON.stringify(result));assert.equal(s.loads,start,'스레드 추가는 통째로 다시 불러오지 않음');assert.equal(s.data[0],first,'바뀌지 않은 스레드는 같은 것 그대로');
  const before=order(),inc2=s.data.find(t=>t[0].id==='inc2');
  result=await call([{action:'patch_blocks',objectId:'a',patches:[{blockId:'inc1m',fields:{VALUE:7}}]}]);
  assert.equal(result.applied,true,JSON.stringify(result));assert.equal(s.loads,start);assert.deepEqual(order(),before,'고친 스레드는 같은 자리에');
  assert.equal(s.data.find(t=>t[0].id==='inc1')[1].params[0],7);assert.equal(s.data.find(t=>t[0].id==='inc2'),inc2,'다른 스레드는 다시 만들지 않음');
  const runOrder=()=>s._eventMap.when_run_button_click.map(b=>b.id).filter(k=>/^inc/.test(k));
  assert.deepEqual(runOrder(),['inc1','inc2'],'다시 만든 스레드도 실행 순서는 스레드 순서 그대로');
  result=await call([{action:'remove_threads',objectId:'a',threadIds:['inc1']}]);assert.equal(result.applied,true,JSON.stringify(result));assert.equal(s.loads,start);assert.ok(!order().includes('inc1'));
  command=commands.pop();command.func(...command.params);assert.equal(s.loads,start,'되돌리기도 통째로 다시 불러오지 않음');assert.deepEqual(order(),before);
  result=await call([{action:'insert_blocks',objectId:'a',inserts:[{afterBlockId:'inc1m',blocks:[{id:'inc1n',type:'move_x',fields:{VALUE:2}}]}]}]);
  assert.equal(result.applied,true,JSON.stringify(result));assert.equal(s.loads,start);assert.deepEqual(order(),before);assert.equal(s.data.find(t=>t[0].id==='inc1')[2].id,'inc1n');
  assert.deepEqual(runOrder(),['inc1','inc2']);
  // ★한 번 열었다 닫은 코드: 메모는 board.code로 자기 코드를 찾고 새 그림은 board 묶음에 붙으므로, 고치는 동안만 그 코드 것으로 바꿔 끼운다
  const shown=new Code([]),board={data:{code:shown},get code(){return this.data.code;},svgThreadGroup:'shownT',svgBlockGroup:'shownB',svgCommentGroup:'shownC'};
  s.view={board,svgThreadGroup:'ownT',svgBlockGroup:'ownB',svgCommentGroup:'ownC'};s.seen.length=0;
  result=await call([{action:'patch_blocks',objectId:'a',patches:[{blockId:'inc1m',fields:{VALUE:8}}]}]);
  assert.equal(result.applied,true,JSON.stringify(result));assert.ok(s.seen.length&&s.seen.every(x=>x.code===s&&x.group==='ownT'),'화면 밖 코드는 자기 코드·자기 그림 묶음으로 고친다');
  assert.equal(board.code,shown);assert.equal(board.svgThreadGroup,'shownT','고친 뒤 화면 쪽은 원래대로');
  s.data.push(clone(inc2));s.seen.length=0;
  result=await call([{action:'patch_blocks',objectId:'a',appendThreads:[[{id:'inc3',type:'when_run_button_click',fields:{}}]]}]);
  assert.equal(result.applied,true,JSON.stringify(result));assert.equal(s.loads,start+1,'머리 번호가 겹치면 통째로 불러온다');assert.equal(order().filter(k=>k==='inc2').length,2);
  assert.ok(s.seen.length&&s.seen.every(x=>x.code===s),'통째로 불러올 때도 메모가 자기 코드에서 지워진다');assert.equal(board.code,shown);delete s.view;
  result=await call([{action:'remove_threads',objectId:'a',threadIds:['inc1','inc2','inc3']}]);assert.equal(result.applied,true,JSON.stringify(result));assert.ok(!order().some(k=>/^inc/.test(k)));
}
// ★열린 오브젝트 이름을 바꾸면 이름 바꾸기 명령처럼 코드 화면 제목도 고친다. 글 코딩 화면에서는 블록 편집이 실행 때 덮이므로 거부한다.
{
  const open=Entry.playground.object,other=actors.find(o=>o!==open),name=open.name,titles=[];Entry.playground.updateObjectTitle=o=>titles.push(o.id);
  result=await call([{action:'set_object',objectId:other.id,properties:{name:other.name}}]);assert.deepEqual(titles,[],'안 열린 오브젝트는 제목을 안 건드린다');
  result=await call([{action:'set_object',objectId:open.id,properties:{name:'새 이름'}}]);assert.equal(result.applied,true,JSON.stringify(result));assert.deepEqual(titles,[open.id],'열린 오브젝트 제목 갱신');
  result=await call([{action:'set_object',objectId:open.id,properties:{name}}]);assert.equal(open.name,name);delete Entry.playground.updateObjectTitle;
  Entry.Workspace={MODE_VIMBOARD:1};Entry.getMainWS=()=>({getMode:()=>1});
  result=await action('edit',{operations:[{action:'set_object',objectId:open.id,properties:{x:5}}]});assert.match(result.__entryMcpError,/TEXT_CODING_MODE/);
  delete Entry.Workspace;delete Entry.getMainWS;
}
// ★편집 요청 번호와 결과는 페이지에 남아, 브리지가 먼저 포기해도 다음 읽기에서 적용 여부가 보인다.
{
  result=await action('edit',{operations:[{action:'set_object',objectId:'a',properties:{x:3}}],requestId:'req-1'});assert.equal(result.applied,true,JSON.stringify(result));
  result=await action('edit',{expectedVersions:{'script:a':'0.0'},operations:[{action:'set_object',objectId:'a',properties:{x:4}}],requestId:'req-2'});assert.match(result.__entryMcpError,/TARGET_CHANGED: script:a/);
  const last=(await action('context',{})).lastEdits,one=last.find(e=>e.requestId==='req-1'),two=last.find(e=>e.requestId==='req-2');
  assert.equal(one.state,'done');assert.equal(one.applied,true);assert.match(one.afterHash,/^[a-f0-9]{64}$/);assert.equal(two.applied,false);assert.match(two.error,/TARGET_CHANGED/);
  const tools=[];let options=null;const empty={objects:[]};
  registerAuthoringTools({registerTool:(name,definition,handler)=>tools.push({name,handler})},
    {bridge:{request:async(method,args,opts)=>{options=opts;throw Error('BRIDGE_TIMEOUT: edit');}},guarded:fn=>fn,project:async()=>empty,checkpoint:async()=>'backup'});
  const pending=await tools.find(t=>t.name==='entry_edit').handler({operations:[{action:'set_object',objectId:'a',properties:{x:1}}]});
  assert.equal(pending.status,'PENDING');assert.equal(pending.reason,'EDIT_STILL_RUNNING');assert.match(pending.requestId,/^[0-9a-f-]{36}$/);assert.ok(options.timeoutMs>15000,'편집은 다른 요청보다 오래 기다린다');assert.ok(GUIDE.recovery.EDIT_STILL_RUNNING);
  const other=[];registerAuthoringTools({registerTool:(name,definition,handler)=>other.push({name,handler})},{bridge:{request:async()=>{throw Error('BRIDGE_NOT_CONNECTED');}},guarded:fn=>fn,project:async()=>empty,checkpoint:async()=>'backup'});
  await assert.rejects(other.find(t=>t.name==='entry_edit').handler({operations:[{action:'set_object',objectId:'a',properties:{x:1}}]}),/BRIDGE_NOT_CONNECTED/,'연결 끊김은 진행 중으로 바꾸지 않는다');
  const tab=[];registerAuthoringTools({registerTool:(name,definition,handler)=>tab.push({name,handler})},{bridge:{request:async()=>{throw Error('BRIDGE_TIMEOUT: selectTab');}},guarded:fn=>fn,project:async()=>empty,checkpoint:async()=>'backup'});
  await assert.rejects(tab.find(t=>t.name==='entry_edit').handler({operations:[{action:'set_object',objectId:'a',properties:{x:1}}]}),/BRIDGE_TIMEOUT: selectTab/,'탭 선택 시간 초과는 편집이 안 간 것이라 진행 중이 아니다');
  const lost=[];registerAuthoringTools({registerTool:(name,definition,handler)=>lost.push({name,handler})},{bridge:{request:async()=>{throw Error('BRIDGE_DISCONNECTED');}},guarded:fn=>fn,project:async()=>empty,checkpoint:async()=>({hash:'c'.repeat(64)})});
  const dropped=await lost.find(t=>t.name==='entry_edit').handler({operations:[{action:'set_object',objectId:'a',properties:{x:1}}]});
  assert.equal(dropped.status,'PENDING');assert.equal(dropped.reason,'EDIT_CONNECTION_LOST','보낸 뒤 끊기면 페이지에서 계속 돌 수 있어 진행 중으로 알린다');assert.match(dropped.nextStep,/c{64}/);assert.ok(GUIDE.recovery.EDIT_CONNECTION_LOST);
  const bridge=new EntryBrowserBridge({port:0}),sentMessages=[];
  bridge.client={readyState:1,send(text,callback){const m=JSON.parse(text);sentMessages.push(m);if(m.method==='selectTab')setTimeout(()=>bridge.receive({id:m.id,ok:true,result:{tabId:7}}),0);callback?.();}};
  const began=Date.now();await assert.rejects(bridge.dispatch('edit',{},7,1000),/BRIDGE_TIMEOUT: edit/);const waited=Date.now()-began;
  assert.ok(waited>=900&&waited<5000,`요청마다 기다리는 시간을 따른다: ${waited}ms`);assert.equal(sentMessages.at(-1).timeoutMs,1000);
  // ★피어는 주인에게 원래 시간을 넘기고, 자기는 주인의 답·시간 초과를 받을 만큼 더 기다린다
  const peer=new EntryBrowserBridge({port:0}),peerMessages=[];
  peer.peer={readyState:1,send(text,callback){const m=JSON.parse(text);peerMessages.push(m);setTimeout(()=>peer.receive({id:m.id,ok:true,result:{applied:true}}),2000);callback?.();}};
  assert.deepEqual(await peer.request('edit',{},{timeoutMs:1000}),{applied:true},'피어는 주인 시간보다 더 기다린다');assert.equal(peerMessages.at(-1).timeoutMs,1000,'주인에게는 원래 시간을 넘긴다');
}
// ★한 메시지가 상한을 넘으면 그 요청만 실패하고 MCP 서버(주인·피어)는 살아 있어야 한다. 진짜 소켓으로 확인한다.
{
  const {WebSocket:Socket}=await import('ws');const KiB=1024,secret='a'.repeat(64);
  const owner=new EntryBrowserBridge({port:0,maxPayload:1024*KiB});owner.secret=secret;const port=await owner.start();
  const extension=async size=>{const s=new Socket(`ws://127.0.0.1:${port}`,{origin:'chrome-extension://'+'a'.repeat(32)});await new Promise(r=>s.once('open',r));
    const ready=new Promise(r=>s.once('message',r));s.send(JSON.stringify({type:'hello',token:secret}));await ready;
    s.on('message',raw=>{const m=JSON.parse(raw);if(m.id)s.send(JSON.stringify({id:m.id,ok:true,result:m.method==='tabs'?[{tabId:7}]:m.method==='selectTab'?{tabId:7}:'x'.repeat(size.value)}));});return s;};
  const size={value:2048*KiB};let ext=await extension(size);
  await assert.rejects(owner.send(owner.client,'snapshot',{}),/^Error: BRIDGE_MESSAGE_TOO_LARGE: .*1 MiB/,'상한을 넘은 메시지는 크기 초과로 그 요청만 실패');
  size.value=10;ext=await extension(size);assert.equal(await owner.send(owner.client,'snapshot',{}),'x'.repeat(10),'크기 초과 뒤에도 주인은 살아서 다음 요청을 받는다');
  const peer=new EntryBrowserBridge({port,maxPayload:512*KiB});peer.secret=secret;await peer.start();assert.ok(peer.peer&&!peer.server);
  size.value=700*KiB;await assert.rejects(peer.request('snapshot',{}),/BRIDGE_MESSAGE_TOO_LARGE: .*1 MiB|BRIDGE_MESSAGE_TOO_LARGE/,'주인이 넘긴 결과가 피어 상한을 넘어도 피어는 크기 초과로 알린다');
  size.value=900*KiB;const big=new EntryBrowserBridge({port,maxPayload:1024*KiB});big.secret=secret;await big.start();assert.equal((await big.request('snapshot',{})).length,900*KiB,'상한 안의 큰 결과는 피어에게도 간다');
  for(const s of [ext,peer.peer,big.peer])s?.close();for(const c of owner.server.clients)c.terminate();await new Promise(r=>owner.server.close(r));
}
// ★사용자와 동시 편집: 작품 전체 해시 없이 작은 편집은 그때의 편집기 상태에 적용하고, 통째로 바꾸는 작업만 대상 버전으로 막는다.
{
  const ctx=await action('context',{});assert.equal(ctx.hash,undefined,'작품 전체 해시는 편집 조건이 아니다');
  const [p,q]=ctx.objects;assert.ok(p&&q&&p.versions.script&&p.versions.pictures&&p.versions.sounds);
  const other=actors.find(o=>o.id===q.id);other.entity.setY(77);
  result=await action('edit',{operations:[{action:'set_object',objectId:p.id,properties:{x:12}}]});
  assert.equal(result.applied,true,'읽은 뒤 다른 오브젝트가 바뀌어도 적용: '+JSON.stringify(result));assert.equal(other.entity.getY(),77,'사용자 변경은 그대로');
  assert.equal(result.versions['script:'+p.id],versionOf('script:'+p.id));assert.equal(result.versions['script:'+p.id],p.versions.script);
  const read=await action('script',{objectId:p.id,depth:4,offset:0,limit:10});assert.equal(read.versionKey,'script:'+p.id);assert.equal(read.version,p.versions.script);assert.equal(read.hash,undefined);
  const mine=actors.find(o=>o.id===p.id),stale=mine.script.toJSON();
  result=await action('edit',{operations:[{action:'set_script',objectId:p.id,threads:stale}]});assert.match(result.__entryMcpError,/VERSION_REQUIRED: script:/);
  mine.script.createThread([{id:'userThread',type:'when_run_button_click',params:[null],statements:[],x:0,y:0}]);
  result=await action('edit',{expectedVersions:{['script:'+p.id]:read.version},operations:[{action:'set_script',objectId:p.id,threads:stale}]});
  assert.match(result.__entryMcpError,/TARGET_CHANGED: script:/);assert.ok(mine.script.toJSON().some(t=>t[0].id==='userThread'),'사용자가 더한 스레드를 덮어쓰지 않는다');
  result=await action('edit',{operations:[{action:'patch_blocks',objectId:p.id,appendThreads:[[{id:'agentThread',type:'when_run_button_click',fields:{}}]]}]});
  assert.equal(result.applied,true,JSON.stringify(result));assert.ok(['userThread','agentThread'].every(id=>mine.script.toJSON().some(t=>t[0].id===id)),'같은 오브젝트 안에서도 작은 편집은 사용자 스레드와 함께 남는다');
  const fresh=(await action('script',{objectId:p.id,depth:4,offset:0,limit:10})).version;
  result=await action('edit',{expectedVersions:{['script:'+p.id]:fresh},operations:[{action:'set_script',objectId:p.id,threads:mine.script.toJSON()}]});assert.equal(result.applied,true,JSON.stringify(result));
  result=await action('edit',{expectedVersions:{['pictures:'+p.id]:'0.0'},operations:[{action:'set_object',objectId:p.id,properties:{x:13}}]});assert.match(result.__entryMcpError,/TARGET_CHANGED: pictures:/,'선택 버전도 맞아야 한다');
  result=await action('edit',{expectedVersions:{['nope:'+p.id]:'0.0'},operations:[{action:'set_object',objectId:p.id,properties:{x:13}}]});assert.match(result.__entryMcpError,/UNKNOWN_VERSION_KEY/);
}
console.log(JSON.stringify({status:'PASS',scope:'live-schema authoring handler and self-describing tool contracts',checks:['per-target version / concurrent user edit','unknown schema/field/dropdown','partial-batch rollback','unexpected-change rollback','named block emission','partial block edit','Undo/Redo callback','running editor rejected','function header key order','function header change rejected','remove in-use rejected','remove threads+message','remove variable','guide/tool discovery','EntryRoot zs_ id drift','EntryRoot export-only lists','create_function','create_function local id format','set_sounds add/invalid/in-use rollback','entry_upload_sound registration','collaboration cache reload keeps edits','reverted edit report','undo limited to edit targets','block ids scoped per code','same-object operations compose','def.params length','remove object on another scene','local variable keeps the open scene','select_scene','table reload fields masked','thread-level script apply','event order kept','off-screen code edited on its own board','open object title','text coding mode rejected','request id result record','edit timeout reported as pending','tab timeout not pending','connection lost after send reported as pending','peer passes original timeout','oversized message fails one request, bridge survives']}));
