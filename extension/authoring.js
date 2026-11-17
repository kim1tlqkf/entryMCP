// ★이 함수는 MAIN world로 직렬화된다. 편집기 계약과 보조 함수는 모두 안에 둔다.
async function entryAuthoringAction(method, args) {
  try {
    if (location.hostname !== 'playentry.org' || !location.pathname.startsWith('/ws/')) throw Error('NOT_ENTRY_EDITOR');
    if (!window.Entry?.container || !Entry.engine) throw Error('ENTRY_NOT_READY');
    const clone = value => JSON.parse(JSON.stringify(value));
    const stopped = () => { if (Entry.engine.state !== 'stop') throw Error('EDITOR_RUNNING: call entry_control with action stop, then entry_context again'); };
    // ★글 코딩 화면은 실행할 때 화면의 글로 코드를 다시 불러오므로, 그동안 바꾼 블록이 조용히 사라진다.
    const blockMode = () => { const vim=Entry.Workspace?.MODE_VIMBOARD; if (vim!==undefined&&Entry.getMainWS?.()?.getMode?.()===vim) throw Error('TEXT_CODING_MODE: the editor is in text coding mode (a failed switch can leave it there while blocks are shown); Entry reloads code from the text when it runs, so block edits would be lost. Ask the user to switch the editor to block coding, then entry_context again'); };
    // ★브리지가 기다리다 포기해도 페이지 안의 편집은 끝까지 돈다. 요청 번호로 결과를 남겨 다음 읽기에서 적용 여부를 알린다.
    const editResults=window.__pemEditResults||=[];
    if(method==='edit'&&args.requestId&&!args.recorded){const rec={requestId:String(args.requestId),startedAt:Date.now(),state:'running'};editResults.push(rec);editResults.splice(0,Math.max(0,editResults.length-20));
      const r=await entryAuthoringAction(method,{...args,recorded:true});
      Object.assign(rec,{state:'done',finishedAt:Date.now(),applied:r?.applied===true,afterHash:r?.afterHash??null,error:r?.__entryMcpError||r?.error||(r?.unexpectedChanges?.length?'UNEXPECTED_CHANGES':null)});return r;}
    // ★읽기 결과는 키 순서가 바뀌어 돌아올 수 있고, 크롬은 확장이 넘기는 인자에서 값이 null인 객체 칸을 뺀다. 둘 다 무시하고 비교한다.
    const sorted=v=>JSON.stringify(v,(k,x)=>x&&typeof x==='object'&&!Array.isArray(x)?Object.keys(x).sort().reduce((o,key)=>(x[key]!==null&&(o[key]=x[key]),o),{}):x);
    // ★EntryRoot 저장 변환이 내보낼 때마다 새로 붙이는 zs_ 번호는 비교에서 뺀다(project.mjs maskGeneratedIds와 같은 규칙).
    const mask = value => {if(!value||typeof value!=='object')return value;const text=t=>typeof t==='string'?t.replace(/"(zcol)?zs_[0-9a-z]+"/g,'"$1zs_"'):t;const out={...value};
      if(Array.isArray(value.objects))out.objects=value.objects.map(o=>typeof o?.script==='string'?{...o,script:text(o.script)}:o);
      if(Array.isArray(value.functions))out.functions=value.functions.map(f=>typeof f?.content==='string'?{...f,content:text(f.content)}:f);
      if(Array.isArray(value.variables))out.variables=value.variables.map(v=>Array.isArray(v?.array)?{...v,array:v.array.map(i=>typeof i?.data==='string'?{...i,data:text(i.data)}:i)}:v);
      // ★표의 updated와 행 key는 작품을 다시 불러올 때 새로 정해지는 값이라 내용 비교에서 뺀다(project.mjs maskGeneratedIds와 같은 규칙).
      if(Array.isArray(value.tables))out.tables=value.tables.map(t=>{if(!t||typeof t!=='object')return t;const {updated,...rest}=t;return Array.isArray(t.data)?{...rest,data:t.data.map(i=>{if(!i||typeof i!=='object')return i;const {key,...row}=i;return row;})}:rest;});return out;};
    const exported = () => mask(Entry.exportProject({}));
    // ★작품 전체를 문자열 하나로 만들지 않고 JSON.stringify와 똑같은 글을 조각으로 흘려 SHA-256을 잰다(서버 hashProject와 같은 값, 큰 작품에서 탭 메모리 절약)
    const sha256=()=>{const K=new Uint32Array([0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
        0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
        0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
        0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2]);
      const H=new Uint32Array([0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19]),W=new Uint32Array(64),buf=new Uint8Array(64);let used=0,total=0;
      const block=(m,o)=>{for(let i=0;i<16;i++)W[i]=(m[o+4*i]<<24)|(m[o+4*i+1]<<16)|(m[o+4*i+2]<<8)|m[o+4*i+3];
        for(let i=16;i<64;i++){const x=W[i-15],y=W[i-2];W[i]=W[i-16]+(((x>>>7)|(x<<25))^((x>>>18)|(x<<14))^(x>>>3))+W[i-7]+(((y>>>17)|(y<<15))^((y>>>19)|(y<<13))^(y>>>10));}
        let a=H[0],b=H[1],c=H[2],d=H[3],e=H[4],f=H[5],g=H[6],h=H[7];
        for(let i=0;i<64;i++){const t1=(h+(((e>>>6)|(e<<26))^((e>>>11)|(e<<21))^((e>>>25)|(e<<7)))+((e&f)^(~e&g))+K[i]+W[i])|0;
          const t2=((((a>>>2)|(a<<30))^((a>>>13)|(a<<19))^((a>>>22)|(a<<10)))+((a&b)^(a&c)^(b&c)))|0;h=g;g=f;f=e;e=(d+t1)|0;d=c;c=b;b=a;a=(t1+t2)|0;}
        H[0]+=a;H[1]+=b;H[2]+=c;H[3]+=d;H[4]+=e;H[5]+=f;H[6]+=g;H[7]+=h;};
      const update=m=>{total+=m.length;let i=0;if(used){const n=Math.min(64-used,m.length);buf.set(m.subarray(0,n),used);used+=n;i=n;if(used<64)return;block(buf,0);used=0;}
        for(;i+64<=m.length;i+=64)block(m,i);if(i<m.length){buf.set(m.subarray(i),0);used=m.length-i;}};
      const hex=()=>{const bits=total*8,pad=new Uint8Array((used<56?56-used:120-used)+8);pad[0]=0x80;const v=new DataView(pad.buffer);
        v.setUint32(pad.length-8,Math.floor(bits/4294967296));v.setUint32(pad.length-4,bits>>>0);update(pad);return [...H].map(x=>x.toString(16).padStart(8,'0')).join('');};
      return {update,hex};};
    const hashJson=value=>{const h=sha256(),enc=new TextEncoder();let s='';const w=t=>{s+=t;if(s.length>65536){h.update(enc.encode(s));s='';}};
      const skip=y=>y===undefined||typeof y==='function'||typeof y==='symbol';
      const emit=x=>{if(x===null||typeof x!=='object'){w(skip(x)?'null':JSON.stringify(x));return;}if(typeof x.toJSON==='function'){emit(x.toJSON());return;}
        if(Array.isArray(x)){w('[');for(let i=0;i<x.length;i++){if(i)w(',');emit(skip(x[i])?null:x[i]);}w(']');return;}
        w('{');let first=true;for(const k of Object.keys(x)){const y=x[k];if(skip(y))continue;if(!first)w(',');first=false;w(JSON.stringify(k)+':');emit(y);}w('}');};
      emit(value);if(s)h.update(enc.encode(s));return h.hex();};
    // masked: exported()처럼 이미 가린 값이면 다시 가리지 않는다(가리기는 스크립트 글을 통째로 새로 만든다)
    const digest = async (value, masked=false) => hashJson(masked?value:mask(value));
    // ★큰 작품은 통째로 문자열로 바꿔 비교하면 그때마다 수십 MB 글이 생겨 탭 메모리가 넘친다 — JSON.stringify 비교와 같은 뜻(빠진 값·함수 무시)으로 직접 견준다
    const same=(a,b)=>{if(a===b)return true;if(typeof a==='number'&&typeof b==='number')return Number.isNaN(a)&&Number.isNaN(b);
      if(!a||!b||typeof a!=='object'||typeof b!=='object'||Array.isArray(a)!==Array.isArray(b))return false;
      if(Array.isArray(a)){if(a.length!==b.length)return false;for(let i=0;i<a.length;i++)if(!same(a[i],b[i]))return false;return true;}
      const keep=o=>Object.keys(o).filter(k=>o[k]!==undefined&&typeof o[k]!=='function'),ka=keep(a);if(ka.length!==keep(b).length)return false;
      for(const k of ka)if(!same(a[k],b[k]))return false;return true;};
    const object = id => { const o=Entry.container.getObject(id); if(!o)throw Error(`OBJECT_NOT_FOUND: ${id}`);return o; };
    const state = () => ({engineState:Entry.engine.state,sceneId:Entry.scene.selectedScene?.id,
      selectedObjectId:Entry.playground.object?.id || null,objects:Entry.container.getCurrentObjects().map(o=>({id:o.id,name:o.name,
        x:o.entity.getX(),y:o.entity.getY(),scaleX:o.entity.getScaleX(),scaleY:o.entity.getScaleY(),visible:o.entity.visible,
        pictureId:o.entity.picture?.id || null,pictureIndex:o.pictures.indexOf(o.entity.picture)+1}))});
    // ★applied:true를 돌려준 뒤에도 Ctrl+Z나 작품을 다시 불러오는 다른 도구가 편집을 되돌릴 수 있다. 다음 호출에서 알리도록 탭에 기록해 둔다.
    const journal=window.__pemEditJournal||=[];
    const liveVariable=id=>{const vc=Entry.variableContainer;return [...vc.variables_,...vc.lists_].find(v=>v.toJSON().id===id);};
    const print=value=>{const text=JSON.stringify(value)??'';let h=2166136261;for(let i=0;i<text.length;i++)h=Math.imul(h^text.charCodeAt(i),16777619);return h>>>0;};
    // ★사용자와 동시에 고칠 수 있게 작품 전체 해시 대신 대상 하나의 버전만 본다. 키: script:<오브젝트>, function:<함수>, pictures:<오브젝트>, sounds:<오브젝트>.
    const version=key=>{const i=String(key).indexOf(':'),kind=key.slice(0,i),id=key.slice(i+1),vc=Entry.variableContainer;
      if(i<1||!['script','function','pictures','sounds'].includes(kind))throw Error(`UNKNOWN_VERSION_KEY: ${key}; use script:, function:, pictures: or sounds:`);
      const tag=value=>{const text=JSON.stringify(value)??'';return `${print(value).toString(16)}.${text.length.toString(16)}`;};
      if(kind==='function'){const f=vc.getFunction(id);return f?tag(f.content.toJSON()):null;}
      const o=Entry.container.getObject(id);if(!o)return null;if(kind==='script')return tag(o.script.toJSON());
      return tag((kind==='pictures'?o.pictures:o.sounds).map(({id,name,filename,fileurl,imageType,dimension,ext,duration})=>[id,name,filename,fileurl,imageType,dimension,ext,duration]));};
    const parts=(kind,id)=>{const vc=Entry.variableContainer;
      if(kind==='object'){const o=Entry.container.getObject(id);if(!o)return null;const {name,rotateMethod,entity}=o.toJSON();return [o.script.toJSON(),{name,rotateMethod,entity}];}
      if(kind==='function'){const f=vc.getFunction(id);return f?[f.content.toJSON()]:null;}
      if(kind==='variable'){const v=liveVariable(id);return v?[v.toJSON()]:null;}
      const m=vc.getMessage(id);return m?[{id:m.id,name:m.name}]:null;};
    const revertedEdits=()=>{const out=[];
      for(const edit of journal){const items=[];
        edit.checks=edit.checks.filter(c=>{const now=parts(c.kind,c.id);
          const state=c.absent?(now?'returned':null):!now?'missing':c.before?.some((p,i)=>p!==c.after[i]&&print(now[i])===p)?'reverted':c.roots?.some(r=>!now[0].some(t=>t[0]?.id===r))?'threads_missing':null;
          if(state)items.push({kind:c.kind,id:c.id,state});return !state;});
        if(items.length)out.push({appliedAt:edit.at,afterHash:edit.afterHash,cause:edit.undone?'undo':'external',items:items.slice(0,50)});}
      journal.splice(0,journal.length,...journal.filter(e=>e.checks.length));return out;};
    if(method==='hash'){if(Entry.engine.state!=='stop')throw Error(`EDITOR_RUNNING: ${Entry.engine.state}`);return {hash:await digest(Entry.exportProject({}))};}
    if(method==='journal')return {revertedEdits:Entry.engine.state==='stop'?revertedEdits():[]};
    if(method==='control') {
      const s=Entry.engine.state,a=args.action;
      if(a==='select_scene') {
        stopped();const scene=Entry.scene.getSceneById(args.sceneId);if(!scene)throw Error(`SCENE_NOT_FOUND: ${args.sceneId}`);
        // ★그림 이름 칸을 고치는 중이면 엔트리가 조용히 장면 전환을 건너뛴다.
        Entry.scene.selectScene(scene);if(Entry.scene.selectedScene.id!==args.sceneId)throw Error('SCENE_NOT_CHANGED: the editor refused to switch; finish the open name edit, then retry');
        return state();
      }
      if(a==='stop'&&s!=='stop') { const b=document.querySelector('button.entryStopButtonWorkspace_w');if(b?.getClientRects().length)b.click();else Entry.engine.toggleStop(); }
      else if(a==='start'&&s==='stop') { const b=document.querySelector('button.entryRunButtonWorkspace_w');if(!b?.getClientRects().length)throw Error('RUN_BUTTON_NOT_VISIBLE');b.click(); }
      else if((a==='pause'&&s==='run')||(a==='resume'&&s==='pause'))Entry.engine.togglePause();
      else if(!['stop','start','pause','resume'].includes(a))throw Error('CONTROL_ACTION_INVALID');
      return state();
    }
    // ★읽기 전용 플레이 기록: 엔진 틱·무대 그리기를 감싸 시간만 재고(게임 결과는 그대로), 화면 순간·긴 프레임·키·서비스 리스트 앞 칸을 모은다.
    //   start는 다시 시작, read는 요약과 원자료, stop은 감싸기를 되돌린다. 페이지를 새로 고치면 사라진다.
    if(method==='perf') {
      const P=window.__pemPerf||(window.__pemPerf={});
      const act=String(args.action||'read');
      const projectName=String(Entry.projectName||document.querySelector('input[class*="projectTitle"], input[class*="title"]')?.value||'').slice(0,80);
      if(act==='stop'){if(P.uninstall)P.uninstall();return {stopped:true,projectName};}
      if(act==='read'){if(!P.rec)return {installed:false,projectName,engineState:Entry.engine.state};return {...P.dump(args),projectName};}
      if(act!=='start')throw Error('PERF_ACTION_INVALID');
      if(P.uninstall)P.uninstall();
      const rec={t0:performance.now(),ticks:[],renders:[],frames:[],keys:[],loaf:[],longTasks:[],cam:[],heavy:[],fnAcc:{},runs:[]};
      P.rec=rec;
      const restore=[];
      const eng=Entry.engine,update=eng.update,hadOwnUpdate=Object.prototype.hasOwnProperty.call(eng,'update');
      let tickFn=null;
      const services=()=>Entry.variableContainer.lists_.filter(l=>/^ers0s[0-9a-f]{24}0000$/.test(l.id_));
      let camLists=services();rec.camLists=camLists.map(l=>l.id_);
      const camSample=()=>{if(camLists.some(l=>!Entry.variableContainer.lists_.includes(l))){camLists=services();rec.camLists=camLists.map(l=>l.id_);}
        rec.cam.push(camLists.map(l=>(l.array_||[]).slice(0,6).map(x=>{const n=Number(x?.data);return Number.isFinite(n)?+n.toFixed(2):null;})));};
      eng.update=function(...a){const s=performance.now();tickFn={};try{return update.apply(this,a);}finally{const d=performance.now()-s;
        if(Entry.engine.state==='run'){rec.ticks.push([+s.toFixed(1),+d.toFixed(2)]);if(rec.cam.length<rec.ticks.length)camSample();
          if(d>25&&rec.heavy.length<800)rec.heavy.push([+s.toFixed(1),+d.toFixed(2),tickFn]);}tickFn=null;}};
      // 엔진 타이머는 멈춤 중에도 돌며 걸 때의 update를 쥐고 있어, 감싸기·되돌리기 때 같은 주기로 다시 건다
      const rearm=()=>{if(eng.ticker&&typeof eng.ticker==='number'){clearInterval(eng.ticker);eng.ticker=setInterval(eng.update,Entry.tickTime);}};
      restore.push(()=>{if(hadOwnUpdate)eng.update=update;else delete eng.update;rearm();});
      rearm();
      const stage=Entry.stage,stageUpdate=stage.update,hadOwnStage=Object.prototype.hasOwnProperty.call(stage,'update');
      stage.update=function(...a){const drew=!!Entry.requestUpdate&&Entry.type!=='invisible';const s=performance.now();
        try{return stageUpdate.apply(this,a);}finally{if(drew&&Entry.engine.state==='run')rec.renders.push([+s.toFixed(1),+(performance.now()-s).toFixed(2),rec.ticks.length]);}};
      restore.push(()=>{if(hadOwnStage)stage.update=stageUpdate;else delete stage.update;});
      let rafId=0;const loop=t=>{if(Entry.engine.state==='run')rec.frames.push(+t.toFixed(1));rafId=requestAnimationFrame(loop);};rafId=requestAnimationFrame(loop);
      restore.push(()=>cancelAnimationFrame(rafId));
      const onKey=down=>e=>{if(Entry.engine.state==='run'&&rec.keys.length<20000&&!e.repeat)rec.keys.push([+performance.now().toFixed(1),e.keyCode,down?1:0]);};
      const kd=onKey(true),ku=onKey(false);document.addEventListener('keydown',kd,true);document.addEventListener('keyup',ku,true);
      restore.push(()=>{document.removeEventListener('keydown',kd,true);document.removeEventListener('keyup',ku,true);});
      const observe=(type,fn)=>{try{const o=new PerformanceObserver(list=>{for(const e of list.getEntries())fn(e);});o.observe({type,buffered:false});restore.push(()=>o.disconnect());}catch{}};
      observe('long-animation-frame',e=>{if(rec.loaf.length<3000)rec.loaf.push([+e.startTime.toFixed(1),+e.duration.toFixed(1),+(e.blockingDuration||0).toFixed(1),
        (e.scripts||[]).slice(0,4).map(s=>[s.invoker,+s.duration.toFixed(1),String(s.sourceURL||'').split('/').pop().split('?')[0].slice(0,40),String(s.sourceFunctionName||'').slice(0,40)])]);});
      observe('longtask',e=>{if(rec.longTasks.length<3000)rec.longTasks.push([+e.startTime.toFixed(1),+e.duration.toFixed(1)]);});
      const onRun=()=>rec.runs.push([+performance.now().toFixed(1),Entry.engine.state]);
      for(const ev of ['run','stop'])Entry.addEventListener?.(ev,onRun);
      restore.push(()=>{for(const ev of ['run','stop'])Entry.removeEventListener?.(ev,onRun);});
      // 함수별 시간(바깥부터 두 단계): 무거운 틱(25ms 넘음)이 어디에 시간을 썼는지 본다. 감싸기 부담이 조금 있다(이전 측정 틱 약 5%).
      if(args.functions!==false){
        const stack=[];
        for(const fid of Object.keys(Entry.variableContainer.functions_)){
          const blk=Entry.block['func_'+fid];if(!blk||typeof blk.func!=='function'||blk.func.__pemPerf)continue;
          const own=Object.prototype.hasOwnProperty.call(blk,'func'),orig=blk.func;
          const wrapped=function(sprite,script){if(stack.length>=2)return orig.call(this,sprite,script);
            const key=stack.length?stack.join('>')+'>'+fid:fid;stack.push(fid);const s=performance.now();
            try{return orig.call(this,sprite,script);}finally{stack.pop();const d=performance.now()-s;const e=rec.fnAcc[key]||(rec.fnAcc[key]=[0,0]);e[0]+=d;e[1]+=1;
              if(tickFn)tickFn[key]=+((tickFn[key]||0)+d).toFixed(3);}};
          wrapped.__pemPerf=true;blk.func=wrapped;
          restore.push(()=>{if(blk.func!==wrapped)return;if(own)blk.func=orig;else delete blk.func;});
        }
      }
      P.uninstall=()=>{for(const f of restore.splice(0).reverse()){try{f();}catch{}}P.uninstall=null;};
      P.dump=(opts={})=>{
        const r=P.rec,times=[];let last=-1;for(const [t,,n] of r.renders){if(n>last){times.push(t);last=n;}}
        const gaps=[];for(let i=1;i<times.length;i++)gaps.push([+(times[i]-times[i-1]).toFixed(1),times[i-1]]);
        const sorted=gaps.map(g=>g[0]).sort((x,y)=>y-x),k=Math.max(1,Math.round(sorted.length*0.01));
        const mean=sorted.length?sorted.reduce((a,b)=>a+b,0)/sorted.length:0,worst=sorted.slice(0,k).reduce((a,b)=>a+b,0)/k;
        const td=r.ticks.map(x=>x[1]).sort((x,y)=>y-x);
        const names={};for(const f of Object.values(Entry.variableContainer.functions_))names[f.id]=String(f.description||'').slice(0,60);
        const summary={contentFrames:gaps.length,avgFps:mean?+(1000/mean).toFixed(1):null,low1Fps:worst?+(1000/worst).toFixed(1):null,
          tickMean:td.length?+(td.reduce((a,b)=>a+b,0)/td.length).toFixed(2):null,tickP99:td[Math.floor(td.length*0.01)]??null,ticks:td.length,
          loaf:r.loaf.length,longTasks:r.longTasks.length,keys:r.keys.length,seconds:+((performance.now()-r.t0)/1000).toFixed(1)};
        return opts.raw?{summary,rec:r,names,engineState:Entry.engine.state}:{summary,engineState:Entry.engine.state};
      };
      return {started:true,projectName,engineState:Entry.engine.state,functions:args.functions!==false,serviceLists:rec.camLists.length};
    }
    if(method==='state')return state();
    if(method==='preview') {
      const canvas=Entry.stage?.canvas || document.getElementById('entryCanvas');
      if(!canvas?.toDataURL)throw Error('STAGE_CANVAS_UNAVAILABLE');
      return {state:state(),dataUrl:canvas.toDataURL('image/png')};
    }
    if(method==='context') {
      const data=state();
      data.scenes=Entry.scene.getScenes().map(s=>({id:s.id,name:s.name}));
      data.objects=Entry.container.getAllObjects().map(o=>({id:o.id,name:o.name,sceneId:o.scene.id,
        objectType:o.objectType,threadCount:o.script.toJSON().length,pictures:o.pictures.length,sounds:o.sounds.length,
        versions:{script:version('script:'+o.id),pictures:version('pictures:'+o.id),sounds:version('sounds:'+o.id)}}));
      data.messages=Entry.variableContainer.messages_.map(m=>({id:m.id,name:m.name}));
      data.variables=[...Entry.variableContainer.variables_,...Entry.variableContainer.lists_].map(v=>{const m=v.toJSON();return {id:m.id,name:m.name,type:m.variableType,objectId:m.object || null};});
      data.functions=Object.values(Entry.variableContainer.functions_).map(f=>({id:f.id,name:String(f.description || f.id).slice(0,100),version:version('function:'+f.id)}));
      data.revertedEdits=Entry.engine.state==='stop'?revertedEdits():[];
      data.lastEdits=editResults.slice(-5);
      data.authoringVersion='0.5.0';
      return data;
    }
    // ★읽기 전용 저장 진단: 엔트리 사이트 saveProject는 아래 단계 중 하나가 던지면 console.warn만 남기고 서버 요청 없이 끝난다
    //   (playentry 2629 청크 #eu: syncCode → Entry.exportProject(작품정보) → getUsedBlockCount의 _schema.class 읽기). 같은 단계를 실행해 오류와 스택을 돌려준다.
    // ★읽기 전용 실행 진단: 시작 직후 페이지 오류(삼켜지는 console.warn/error, 처리 안 된 오류·거부)를 가로채고,
    //   3초 뒤 엔진 상태·돌고 있는 실행기 수·틱 진행 여부를 돌려준다. 끝나면 원래대로 멈춘다.
    if(method==='diagnose_run') {
      const caught=[],orig={warn:console.warn,error:console.error};
      const pack=a=>a.map(x=>x instanceof Error?{message:x.message,stack:String(x.stack||'').split('\n').slice(0,15)}:String(x?.message||x).slice(0,400));
      console.warn=(...a)=>{caught.push({kind:'warn',args:pack(a)});orig.warn.apply(console,a);};
      console.error=(...a)=>{caught.push({kind:'error',args:pack(a)});orig.error.apply(console,a);};
      const onErr=e=>caught.push({kind:'onerror',args:pack([e.error||e.message])});const onRej=e=>caught.push({kind:'unhandledrejection',args:pack([e.reason])});
      window.addEventListener('error',onErr);window.addEventListener('unhandledrejection',onRej);
      const sample=()=>{let ex=0;for(const o of Entry.container.getAllObjects())ex+=(o.script?.executors?.length||0);return {state:Entry.engine.state,executors:ex,sceneId:Entry.scene.selectedScene?.id};};
      const before=sample();let startErr=null;
      try{if(Entry.engine.state!=='run')await Entry.engine.toggleRun();}catch(e){startErr=pack([e])[0];}
      const t0=sample();await new Promise(r=>setTimeout(r,3000));const t3=sample();
      // ★틱이 안 도는 이유: 엔진 루프 상태·감싸기 여부를 보고, 장면 오브젝트마다 틱을 한 번 직접 돌려 던지는 오류를 잡는다.
      const eng=Entry.engine,src=f=>typeof f==='function'?String(f).slice(0,300):typeof f;
      const engineInfo={isUpdating:eng.isUpdating,state:eng.state,updateSrc:src(eng.update),tickSrc:src(Entry.Code?.prototype?.tick),
        ownUpdate:Object.prototype.hasOwnProperty.call(eng,'update'),ownToggleRun:Object.prototype.hasOwnProperty.call(eng,'toggleRun'),
        ticker:typeof eng.ticker,speed:eng.speeds?.[eng.speed]??eng.speed,isTurbo:Entry.isTurbo,isPaused:eng.isState?.('pause')};
      const tickErrors=[];
      for(const o of Entry.container.getCurrentObjects()){try{o.script.tick();}catch(e){tickErrors.push({object:o.id,name:o.name,error:pack([e])[0]});}}
      const t4=sample();
      window.removeEventListener('error',onErr);window.removeEventListener('unhandledrejection',onRej);console.warn=orig.warn;console.error=orig.error;
      try{if(Entry.engine.state!=='stop')await Entry.engine.toggleStop();}catch(e){caught.push({kind:'stop',args:pack([e])});}
      return {before,startErr,afterStart:t0,after3s:t3,engineInfo,tickErrors,afterManualTick:t4,caught:caught.slice(0,20)};
    }
    if(method==='diagnose_save') {
      if(args.readLast)return {last:window.__pemSaveDiag||null};stopped();const out={steps:[]};
      const step=(name,fn)=>{try{const v=fn();out.steps.push({name,ok:true,info:v});}catch(e){out.steps.push({name,ok:false,error:String(e?.message||e),stack:String(e?.stack||'').split('\n').slice(0,12)});}};
      step('exportProject({})',()=>{const r=Entry.exportProject({});return r?{objects:r.objects?.length}:null;});
      const info=Entry.projectId?{id:Entry.projectId,name:Entry.projectName}:{};
      step('exportProject(projectInfo)',()=>{const r=Entry.exportProject({...info,name:document.querySelector('input[value]')?.value||'project'});return r?{objects:r.objects?.length}:null;});
      step('blockSchemas',()=>{const bad=[];for(const o of Entry.container.getAllObjects())for(const b of o.script.getBlockList()){if(!b._schema)bad.push({object:o.id,name:o.name,id:b.id,type:b.type});}if(bad.length)throw Object.assign(Error(`MISSING_SCHEMA x${bad.length}: `+JSON.stringify(bad.slice(0,20))),{});return 'all blocks have schema';});
      step('functionContents',()=>{const bad=[];for(const f of Object.values(Entry.variableContainer.functions_)){try{f.content.toJSON();}catch(e){bad.push({id:f.id,error:String(e.message)});}}if(bad.length)throw Error('FUNCTION_SERIALIZE '+JSON.stringify(bad.slice(0,20)));return Object.keys(Entry.variableContainer.functions_).length+' functions ok';});
      step('objectScripts',()=>{const bad=[];for(const o of Entry.container.getAllObjects()){try{o.script.stringify();}catch(e){bad.push({id:o.id,name:o.name,error:String(e.message)});}}if(bad.length)throw Error('SCRIPT_SERIALIZE '+JSON.stringify(bad));return 'ok';});
      // ★사이트의 진짜 저장 함수를 실행해 삼켜지는 console.warn(오류·스택)을 받아 온다. 사용자가 저장을 요청했을 때만(args.runSiteSave).
      if(args.runSiteSave) {
        const root=document.getElementById('__next')||document.body.firstElementChild;const key=root&&Object.keys(root).find(k=>k.startsWith('__reactContainer$')||k.startsWith('__reactFiber$'));
        let helper=null;const stack=[key&&root[key]?.stateNode?.current||(key&&root[key])];
        for(let n=0;stack.length&&n<200000&&!helper;n++){const f=stack.pop();if(!f)continue;const v=f.memoizedProps?.value;if(v&&typeof v==='object'&&typeof v.saveProject==='function'&&'modalProgress' in v)helper=v;if(f.child)stack.push(f.child);if(f.sibling)stack.push(f.sibling);}
        if(!helper){out.steps.push({name:'siteSave',ok:false,error:'SITE_HELPER_NOT_FOUND'});return out;}
        const warned=[],origWarn=console.warn,origError=console.error;
        const grab=kind=>(...a)=>{warned.push({kind,args:a.map(x=>x instanceof Error?{message:x.message,stack:String(x.stack||'').split('\n').slice(0,15)}:String(x).slice(0,500))});};
        console.warn=grab('warn');console.error=grab('error');
        try{await helper.saveProject();}catch(e){warned.push({kind:'throw',args:[{message:e.message,stack:String(e.stack||'').split('\n').slice(0,15)}]});}
        finally{console.warn=origWarn;console.error=origError;}
        const rec={name:'siteSave',ok:warned.length===0,warnings:warned.slice(0,10),at:Date.now()};window.__pemSaveDiag=rec;out.steps.push(rec);
      }
      return out;
    }
    if(method==='script') {
      stopped();const target=args.functionId?Entry.variableContainer.getFunction(args.functionId):object(args.objectId);
      if(!target)throw Error('FUNCTION_NOT_FOUND');const code=args.functionId?target.content:target.script;
      const threads=code.toJSON();
      const summarize=b=>({id:b.id,type:b.type,x:b.x,y:b.y,statementLengths:b.statements?.map(t=>t.length) || []});
      function shorten(b,depth){if(depth<=0)return {...summarize(b),truncated:true};return {...b,
        params:b.params?.map(p=>p&&typeof p==='object'&&p.type?shorten(p,depth-1):p),
        statements:b.statements?.map(t=>t.map(x=>shorten(x,depth-1)))};}
      const find=(value,id)=>{if(!value||typeof value!=='object')return null;if(value.id===id&&value.type)return value;
        for(const v of Array.isArray(value)?value:[...(value.params||[]),...(value.statements||[])]){const r=find(v,id);if(r)return r;}return null;};
      let data;
      if(args.blockId){const b=find(threads,args.blockId);if(!b)throw Error('BLOCK_NOT_FOUND');data={block:shorten(b,args.depth)};}
      else if(args.threadIndex!==undefined){const t=threads[args.threadIndex];if(!t)throw Error('THREAD_NOT_FOUND');data={threadIndex:args.threadIndex,blocks:t.slice(args.offset,args.offset+args.limit).map(b=>shorten(b,args.depth)),blockTotal:t.length};}
      else data={threadRoots:threads.slice(args.offset,args.offset+args.limit).map((t,i)=>({index:args.offset+i,root:summarize(t[0]),topLevelBlocks:t.length}))};
      const versionKey=args.functionId?`function:${args.functionId}`:`script:${args.objectId}`;
      return {versionKey,version:version(versionKey),objectId:args.objectId,functionId:args.functionId,
        total:threads.length,offset:args.offset,...data,
        nextOffset:args.offset+args.limit<threads.length?args.offset+args.limit:null,
        format:'Native blocks from the live editor. Keep unchanged IDs. New blocks may use type, fields keyed by entry_block_schema.paramsKeyMap, and statements.'};
    }
    if(method==='upload') {
      stopped();const bytes=Uint8Array.from(atob(args.base64),c=>c.charCodeAt(0));
      const form=new FormData();form.append('type','user');form.append('uploadFile0',new File([bytes],args.filename,{type:args.mimeType}));
      const r=await fetch('/rest/picture/upload',{method:'POST',credentials:'same-origin',body:form});const body=await r.json().catch(()=>null),p=body?.uploads?.[0];
      if(!r.ok||!p?.filename||!p.dimension)throw Error(`ASSET_UPLOAD_FAILED: ${r.status}`);
      return {id:Entry.generateHash(),name:args.filename,filename:p.filename,imageType:p.imageType,dimension:p.dimension,
        fileurl:`/uploads/${p.filename.slice(0,2)}/${p.filename.slice(2,4)}/image/${p.filename}.${p.imageType}`};
    }
    if(method==='upload_batch') {
      // Same request as Entry's own multi-file picker: one form with uploadFile0..n. Answers are matched by the sent name; a missing one comes back null.
      stopped();const form=new FormData();form.append('type','user');
      args.files.forEach((f,i)=>form.append(`uploadFile${i}`,new File([Uint8Array.from(atob(f.base64),c=>c.charCodeAt(0))],f.filename,{type:f.mimeType})));
      const r=await fetch('/rest/picture/upload',{method:'POST',credentials:'same-origin',body:form});const body=await r.json().catch(()=>null);
      if(!r.ok||!Array.isArray(body?.uploads))throw Error(`ASSET_UPLOAD_FAILED: ${r.status}`);
      const got=body.uploads.filter(p=>p?.filename&&p.dimension),byName=new Map(got.map(p=>[p.name,p]));
      return args.files.map((f,i)=>{const p=byName.get(f.filename)??(byName.has(undefined)&&got.length===args.files.length?got[i]:null);
        return p?{id:Entry.generateHash(),name:f.filename,filename:p.filename,imageType:p.imageType,dimension:p.dimension,
          fileurl:`/uploads/${p.filename.slice(0,2)}/${p.filename.slice(2,4)}/image/${p.filename}.${p.imageType}`}:null;});
    }
    if(method==='upload_sound') {
      // Same request shape as the editor's sound popup (file upload): type=user + uploadFile0.
      stopped();const bytes=Uint8Array.from(atob(args.base64),c=>c.charCodeAt(0));
      const form=new FormData();form.append('type','user');form.append('uploadFile0',new File([bytes],args.filename,{type:'audio/mpeg'}));
      const r=await fetch('/rest/sound/upload',{method:'POST',credentials:'same-origin',body:form});const body=await r.json().catch(()=>null);
      const s=body?.uploads?.[0]||(Array.isArray(body)?body[0]:body);
      if(!r.ok||!s?.filename||!(Number(s.duration)>0))throw Error(`SOUND_UPLOAD_FAILED: ${r.status}`);
      return {id:Entry.generateHash(),name:args.filename,filename:s.filename,ext:s.ext||'.mp3',duration:Number(s.duration)};
    }
    if(method==='undo') {
      stopped();blockMode();const sm=Entry.stateManager,stack=args.action==='redo'?sm.redoStack_:sm.undoStack_;
      if(stack?.at(-1)?.message!=='entry-mcp-edit')throw Error('LAST_ACTION_IS_NOT_MCP_EDIT: preserve other user actions');
      if(args.action==='redo')sm.redo();else {sm.undo(1);const i=journal.findLastIndex(e=>e.undone);if(i>=0)journal.splice(i,1);}
      return {action:args.action,...state()};
    }
    if(method!=='edit')throw Error('UNKNOWN_AUTHORING_ACTION');
    // ★여기부터 적용·검사까지 await가 없어야 한다. 사용자 조작이 끼어들 틈이 없어 before/after 비교가 이 편집만 본다.
    stopped();blockMode();const before=exported();
    // ★목록을 통째로 바꾸는 작업만 버전을 요구한다. 읽은 뒤 사용자가 그 대상을 고쳤으면 덮어써 지우지 않고 거절한다.
    const expectedVersions=args.expectedVersions||{},whole={set_script:'script',set_function:'function',set_pictures:'pictures',set_sounds:'sounds'};
    for(const key of new Set(args.operations.filter(o=>whole[o.action]).map(o=>`${whole[o.action]}:${o.objectId??o.functionId}`)))
      if(!(key in expectedVersions))throw Error(`VERSION_REQUIRED: ${key} replaces the whole list; pass expectedVersions["${key}"] from entry_context or entry_script`);
    for(const [key,want] of Object.entries(expectedVersions)){const now=version(key);
      if(now!==want)throw Error(`TARGET_CHANGED: ${key} is ${now??'missing'}, expected ${want}; it changed after you read it (the user may be editing it). Re-read it and rebuild the edit`);}
    let count=0,ids=new Map(),existing=new Map();
    const countIds=(value,seen=new Map())=>{if(Array.isArray(value))value.forEach(v=>countIds(v,seen));else if(value&&typeof value==='object'){if(value.id&&value.type)seen.set(value.id,(seen.get(value.id)||0)+1);
      for(const v of [...(value.params||[]),...(value.statements||[])])countIds(v,seen);}return seen;};
    // ★블록 id는 코드 하나 안에서만 구분되고 복사한 오브젝트는 같은 id를 그대로 갖는다. 이미 있던 겹침은 두고 새로 생기는 겹침만 거부한다.
    const forCode=live=>{ids=new Map();existing=countIds(live);};
    const claim=id=>{const n=(ids.get(id)||0)+1;if(n>Math.max(1,existing.get(id)||0))throw Error(`DUPLICATE_BLOCK_ID: ${id}`);ids.set(id,n);};
    // ★한 묶음에서 같은 오브젝트를 두 번 고치면 뒤 작업이 앞 작업 결과에 이어지게 한다(각자 편집 전 스크립트에서 시작하면 앞 작업이 사라진다).
    const drafts=new Map();
    const draft=id=>{if(!drafts.has(id))drafts.set(id,object(id).script.toJSON());return drafts.get(id);};
    // ★새 함수의 원형 칸 블록 종류는 함수가 만들어진 뒤에야 Entry.block에 생기므로, 그 함수 머리에서 선언된 것만 미리 허용한다.
    const pendingParamTypes=new Set();
    function block(input) {
      if(!input||typeof input!=='object'||Array.isArray(input)||typeof input.type!=='string')throw Error('BLOCK_TYPE_REQUIRED');
      if(++count>20000)throw Error('TOO_MANY_BLOCKS');const d=Entry.block[input.type];
      if(!d&&pendingParamTypes.has(input.type)){const out={id:input.id || Entry.generateHash(),type:input.type,params:[],statements:[]};claim(out.id);return out;}
      if(!d)throw Error(`UNKNOWN_BLOCK_TYPE: ${input.type}; call entry_block_schema`);
      if(input.fields&&input.params)throw Error(`FIELDS_AND_PARAMS_ARE_EXCLUSIVE: ${input.type}`);
      const out=clone(input);delete out.fields;const definitions=d.params || [];
      out.id ||= Entry.generateHash();claim(out.id);
      const defaults=()=>definitions.map((p,i)=>p?.type==='Indicator'||p?.type==='Text'?null:clone(d.def?.params?.[i] ?? p?.value ?? null));
      if(input.fields) {
        const map=d.paramsKeyMap || {};out.params=defaults();
        for(const [key,value] of Object.entries(input.fields)) {if(!(key in map))throw Error(`UNKNOWN_BLOCK_FIELD: ${input.type}.${key}; use entry_block_schema.paramsKeyMap`);out.params[map[key]]=value;}
      } else out.params=input.params?clone(input.params):defaults();
      // ★엔트리 def.params는 정의 칸보다 길 수 있다(text_read 등). 남는 칸이 비어 있으면 저장되는 모양으로 줄인다.
      while(out.params.length>definitions.length&&(out.params.at(-1)===null||out.params.at(-1)===undefined))out.params.pop();
      if(out.params.length!==definitions.length)throw Error(`BLOCK_PARAM_COUNT: ${input.type} requires ${definitions.length}`);
      out.params=out.params.map((p,i)=> {
        if(p&&typeof p==='object'&&p.type)return block(p);
        const def=definitions[i];
        // ★엔트리는 값 칸의 날값이 참일 때만 숫자 블록으로 감싸고 0·''·false는 기본값 블록(10 등)으로 바꾼다 — 그 셋은 칸의 기본 블록 모양으로 직접 감싼다
        if((def?.type==='Block'||def?.type==='Output')&&(p===0||p===''||p===false)){
          const t=d.def?.params?.[i]?.type,kind=t&&Entry.block[t]?.isPrimitive?t:'number';
          return block({type:kind,params:[kind==='text'?String(p):p]});}
        if(def?.type==='Dropdown'&&def.options&&!def.options.some(o=>String(o[1])===String(p)))throw Error(`INVALID_DROPDOWN: ${input.type}[${i}] ${p}`);
        return p;
      });
      const slots=d.statements?.length || 0;out.statements=input.statements || Array.from({length:slots},()=>[]);
      if(out.statements.length!==slots)throw Error(`BLOCK_STATEMENT_COUNT: ${input.type} requires ${slots}`);
      out.statements=out.statements.map(thread=>thread.map(block));return out;
    }
    const operations=args.operations.map(op=> {
      const p=clone(op);
      if(p.action==='patch_blocks') {
        const current=clone(draft(p.objectId));
        const find=(v,id)=>{if(!v||typeof v!=='object')return null;if(v.id===id&&v.type)return v;
          for(const x of Array.isArray(v)?v:[...(v.params||[]),...(v.statements||[])]){const found=find(x,id);if(found)return found;}return null;};
        for(const patch of p.patches || []){const b=find(current,patch.blockId);if(!b)throw Error(`BLOCK_NOT_FOUND: ${patch.blockId}`);
          const map=Entry.block[b.type]?.paramsKeyMap || {};for(const [key,value] of Object.entries(patch.fields)){
            if(!(key in map))throw Error(`UNKNOWN_BLOCK_FIELD: ${b.type}.${key}`);b.params[map[key]]=value;}}
        p.action='set_script';p.threads=[...current,...(p.appendThreads || [])];delete p.patches;delete p.appendThreads;
      }
      if(p.action==='remove_threads') {
        const current=clone(draft(p.objectId));
        for(const tid of p.threadIds)if(!current.some(t=>t[0]?.id===tid))throw Error(`THREAD_NOT_FOUND: ${tid}`);
        p.action='set_script';p.threads=current.filter(t=>!p.threadIds.includes(t[0]?.id));delete p.threadIds;
      }
      if(p.action==='insert_blocks') {
        // ★큰 스레드를 통째로 다시 보내지 않고 기존 블록 앞뒤에 끼운다. 값 칸 안의 블록은 끼울 자리가 아니므로 스레드·명령 칸 배열만 찾는다.
        const current=clone(draft(p.objectId));
        const locate=(stack,id)=>{for(let i=0;i<stack.length;i++){if(stack[i]?.id===id)return {stack,index:i};
          for(const inner of stack[i]?.statements || []){const found=locate(inner,id);if(found)return found;}}return null;};
        for(const insert of p.inserts) {
          const target=insert.afterBlockId ?? insert.beforeBlockId;let found=null;
          for(const thread of current){found=locate(thread,target);if(found)break;}
          if(!found)throw Error(`BLOCK_NOT_IN_STACK: ${target}; use a statement block ID from entry_script (not a value block inside another block)`);
          if(insert.beforeBlockId&&found.index===0&&current.includes(found.stack))throw Error(`CANNOT_INSERT_BEFORE_THREAD_HEAD: ${target}`);
          found.stack.splice(found.index+(insert.afterBlockId?1:0),0,...clone(insert.blocks));
        }
        p.action='set_script';p.threads=current;delete p.inserts;
      }
      if(p.action==='remove_variable'&&!Entry.variableContainer.variables_.concat(Entry.variableContainer.lists_).some(v=>v.toJSON().id===p.id))throw Error(`VARIABLE_NOT_FOUND: ${p.id}`);
      if(p.action==='remove_message'&&!Entry.variableContainer.getMessage(p.id))throw Error(`MESSAGE_NOT_FOUND: ${p.id}`);
      if(p.action==='create_function') {
        const vc=Entry.variableContainer;if(vc.getFunction(p.model.id))throw Error(`FUNCTION_ID_EXISTS: ${p.model.id}`);
        const head=p.model.threads?.[0]?.[0];if(!['function_create','function_create_value'].includes(head?.type))throw Error('FUNCTION_HEADER_REQUIRED: threads[0][0] must be function_create');
        pendingParamTypes.clear();
        (function collect(b){if(!b||typeof b!=='object')return;if(['function_field_string','function_field_boolean'].includes(b.type)&&b.params?.[0]?.type)pendingParamTypes.add(b.params[0].type);(b.params||[]).forEach(collect);})(head.params?.[0]);
        const localIds=new Set(p.model.localVariables.map(v=>v.id));if(localIds.size!==p.model.localVariables.length)throw Error('LOCAL_VARIABLE_ID_DUPLICATE');
        // ★엔트리 set/get_func_variable은 지역 변수 id를 첫 '_'에서 잘라 함수를 찾는다 — 어긋나면 실행 중 함수를 못 찾아 멈춘다.
        if(String(p.model.id).includes('_'))throw Error(`FUNCTION_ID_UNDERSCORE: ${p.model.id} (Entry finds the function from the text before the first "_" of a local variable id)`);
        for(const lid of localIds)if(String(lid).split('_')[0]!==p.model.id)throw Error(`LOCAL_VARIABLE_ID_FORMAT: ${lid} must be ${p.model.id}_<suffix>`);
        forCode([]);p.model.threads=p.model.threads.map(t=>t.map(block));
        const used=[...JSON.stringify(p.model.threads).matchAll(/"type":"(?:get|set)_func_variable","params":\["([^"]+)"/g)].map(m=>m[1]);
        for(const lid of used)if(!localIds.has(lid))throw Error(`LOCAL_VARIABLE_NOT_DECLARED: ${lid}`);
      }
      if(p.action==='remove_function'&&!Entry.variableContainer.getFunction(p.functionId))throw Error(`FUNCTION_NOT_FOUND: ${p.functionId}`);
      if(p.action==='set_script'||p.action==='set_function') {
        const live=p.action==='set_script'?draft(p.objectId):Entry.variableContainer.getFunction(p.functionId)?.content.toJSON()||[];forCode(live);
        // ★바뀌지 않은 스레드는 이미 편집기에 있는 내용이다. 새 블록 규칙으로 다시 재면 없는 함수를 부르는 끊긴 스레드 때문에 다른 곳도 못 고친다.
        const same=new Map(live.map(t=>[t[0]?.id,sorted(t)]));
        p.threads=p.threads.map(t=>{if(same.get(t[0]?.id)!==sorted(t))return t.map(block);for(const [id,n] of countIds(t))for(let i=0;i<n;i++)claim(id);return t;});
        if(p.action==='set_script')drafts.set(p.objectId,p.threads);
      }
      if(p.action==='set_function') {
        const f=Entry.variableContainer.getFunction(p.functionId);if(!f)throw Error('FUNCTION_NOT_FOUND');
        const header=v=>sorted(v[0]?.[0]?.params ?? null);
        const sent=header(p.threads),live=header(f.content.toJSON());
        if(sent!==live){let i=0;while(i<sent.length&&sent[i]===live[i])i++;
          throw Error(`FUNCTION_PARAMETERS_CHANGED: preserve the function_create header when editing its body; first difference at ${i}: sent …${sent.slice(Math.max(0,i-60),i+60)}… live …${live.slice(Math.max(0,i-60),i+60)}…`);}
      }
      if(p.objectId)object(p.objectId);
      if(p.action==='add_object') {
        if(Entry.container.getObject(p.id))throw Error('OBJECT_ID_EXISTS');
        const template=object(p.templateObjectId).toJSON();if(!template.sprite.pictures.length)throw Error('TEMPLATE_REQUIRES_PICTURE');
        p.model={id:p.id,name:p.name,objectType:'sprite',rotateMethod:template.rotateMethod,scene:Entry.scene.selectedScene.id,
          sprite:{pictures:template.sprite.pictures.map(pic=>({...pic,id:Entry.generateHash()})),sounds:[]},script:'[]',entity:clone(template.entity)};
        p.model.selectedPictureId=p.model.sprite.pictures[0].id;
      }
      if(p.action==='set_pictures') {
        if(!p.pictures.length)throw Error('PICTURE_REQUIRED');const seen=new Set();
        p.pictures.forEach(pic=>{if(!pic.id||!pic.name||!pic.dimension||!(pic.dimension.width>0&&pic.dimension.height>0)||seen.has(pic.id))throw Error('PICTURE_MODEL_INVALID');seen.add(pic.id);
          if(pic.fileurl&&!/^\/uploads\/|^https:\/\/playentry\.org\/uploads\/|^data:image\/(png|jpeg|webp|svg\+xml);base64,/.test(pic.fileurl))throw Error('PICTURE_URL_MUST_BE_ENTRY_OR_EMBEDDED');});
      }
      if(p.action==='set_sounds') {
        // Entry.initSound skips a sound whose duration is 0, which would leave it silent.
        const seen=new Set();
        p.sounds.forEach(s=>{if(!s.id||!s.name||!(Number(s.duration)>0)||!(s.filename||s.fileurl)||seen.has(s.id))throw Error('SOUND_MODEL_INVALID');seen.add(s.id);
          if(s.fileurl&&!/^\/uploads\/|^https:\/\/playentry\.org\/uploads\//.test(s.fileurl))throw Error('SOUND_URL_MUST_BE_ENTRY');});
        p.removedSoundIds=object(p.objectId).sounds.map(s=>s.id).filter(sid=>!seen.has(sid));
      }
      return p;
    });
    const vc=Entry.variableContainer,sm=Entry.stateManager;
    const objectIds=[...new Set(operations.flatMap(o=>o.objectId?[o.objectId]:o.action==='add_object'?[o.id]:[]))];
    const variableIds=[...new Set(operations.filter(o=>o.action==='upsert_variable').map(o=>o.model.id).concat(operations.filter(o=>o.action==='remove_variable').map(o=>o.id)))];
    for(const op of operations.filter(o=>o.action==='remove_object'))for(const v of [...vc.variables_,...vc.lists_])if(v.toJSON().object===op.objectId)variableIds.push(v.toJSON().id);
    const messageIds=operations.filter(o=>['upsert_message','remove_message'].includes(o.action)).map(o=>o.id);
    const functionIds=operations.filter(o=>o.action==='set_function').map(o=>o.functionId).concat(operations.filter(o=>o.action==='create_function').map(o=>o.model.id)).concat(operations.filter(o=>o.action==='remove_function').map(o=>o.functionId));
    const findVariable=liveVariable;
    const readState=()=>({objects:[...new Set([...Entry.container.getAllObjects().map(o=>o.id),...objectIds])].map(id=>{const o=Entry.container.getObject(id);return {id,model:o?o.toJSON():null};}),
      variables:[...new Set([...vc.variables_,...vc.lists_].map(v=>v.toJSON().id).concat(variableIds))].map(id=>({id,model:findVariable(id)?.toJSON() || null})),
      messages:[...new Set(vc.messages_.map(m=>m.id).concat(messageIds))].map(id=>{const m=vc.getMessage(id);return {id,model:m?{id:m.id,name:m.name}:null};}),
      functions:Object.keys(vc.functions_).map(id=>{const f=vc.getFunction(id);return {id,threads:f.content.toJSON(),type:f.type,localVariables:clone(f.localVariables||[]),useLocalVariables:!!f.useLocalVariables};}),
      order:Entry.container.getAllObjects().map(o=>o.id),variableOrder:vc.variables_.map(v=>v.toJSON().id),listOrder:vc.lists_.map(v=>v.toJSON().id),messageOrder:vc.messages_.map(m=>m.id),
      selected:Entry.playground.object?.id || null,scene:Entry.scene.selectedScene?.id});
    const original=readState();
    // ★지역 변수를 넣으면 엔트리가 그 변수를 선택하며 주인 오브젝트의 장면으로 옮긴다. 편집이 사용자 화면을 옮기지 않게 시작 때 보던 곳으로 되돌린다.
    const stay=view=>{if(vc.selected?.object_)vc.select(vc.selected);const home=Entry.scene.getSceneById(view.scene);if(home&&home.id!==Entry.scene.selectedScene.id)Entry.scene.selectScene(home);};
    const updateViews=(view,reinject=true)=>{stay(view);
      Entry.container.setCurrentObjects();Entry.container.updateListView();const o=Entry.container.getObject(view.selected)||Entry.container.getCurrentObjects()[0];
      if(o&&(reinject||Entry.playground.object!==o)){const positions=o.script.toJSON().map(t=>t[0]).filter(b=>b.x!==undefined&&b.y!==undefined);
        Entry.playground.injectObject(null);Entry.container.selectObject(o.id);Entry.playground.injectObject(o);
        for(const p of positions){const t=o.script.getThreads().find(t=>t.getFirstBlock()?.id===p.id);t?.getFirstBlock().set({x:p.x,y:p.y});}}
      vc.updateList();Entry.Utils.doCodeChange();Entry.requestUpdate=true;};
    const putVariable=model=>{const v=findVariable(model.id);if(v){if(v.toJSON().variableType==='list')vc.removeList(v);else vc.removeVariable(v);}if(model.variableType==='list')vc.addList(clone(model));else vc.addVariable(clone(model));};
    // ★메모는 board.code를 자기 코드로 여기고, 새 블록 그림은 board의 그림 묶음에 붙는다. 화면에 없는 코드를 고치는 동안만 둘 다 그 코드 것으로 바꿔 끼운다.
    const groupKeys=['svgThreadGroup','svgBlockGroup','svgCommentGroup'];
    const onOwnBoard=(code,fn,groups=true)=>{const cv=code.view,board=cv?.board||code.board;
      const swapGroups=groups&&!!cv&&!!board&&groupKeys.some(k=>board[k]!==cv[k]);
      if(!board?.data||(board.code===code&&!swapGroups))return fn();
      if(swapGroups&&groupKeys.some(k=>!cv[k]))return null;
      const saved=[board.data.code,...groupKeys.map(k=>board[k])];board.data.code=code;if(swapGroups)groupKeys.forEach(k=>{board[k]=cv[k];});
      try{return fn();}finally{board.data.code=saved[0];if(swapGroups)groupKeys.forEach((k,i)=>{board[k]=saved[i+1];});}};
    // ★실행 순서는 이벤트 등록 순서를 따르고 다시 만든 스레드는 맨 뒤에 등록되므로, 다시 불러왔을 때와 같은 스레드 순서로 맞춘다.
    const orderEvents=code=>{const at=new Map(code.getThreads().map((t,i)=>[t.getFirstBlock?.(),i]));
      for(const list of Object.values(code._eventMap||{}))if(Array.isArray(list))list.splice(0,list.length,...list.map((b,i)=>[at.get(b)??Infinity,i,b]).sort((x,y)=>(x[0]-y[0])||(x[1]-y[1])).map(x=>x[2]));};
    // ★통째로 다시 불러오면 큰 오브젝트는 블록을 전부 다시 만들어 수십 초 걸린다. 바뀐 스레드만 빼고 넣고, 맞출 수 없을 때만 통째로 불러온다.
    const putThreads=(code,target)=>{
      const full=()=>{onOwnBoard(code,()=>{code.destroyView();code.load(target);},false);return 'full';};
      const live=code.getThreads(),liveKeys=live.map(t=>t.getFirstBlock?.()?.id),targetKeys=target.map(t=>t?.[0]?.id);
      const unique=keys=>keys.every(Boolean)&&new Set(keys).size===keys.length;
      // ★함수 정의 머리 스레드는 Code.load만 뒤 블록을 안으로 옮긴다.
      if(!unique(liveKeys)||!unique(targetKeys)||target.some(t=>!Array.isArray(t)||!t.length||t[0]?.type==='function_create'))return full();
      const liveText=new Map(live.map((t,i)=>[liveKeys[i],sorted(t.toJSON())]));
      const keep=new Set(targetKeys.filter((k,i)=>liveText.get(k)===sorted(target[i])));
      if(liveKeys.filter(k=>keep.has(k)).join('\n')!==targetKeys.filter(k=>keep.has(k)).join('\n'))return full();
      const done=onOwnBoard(code,()=>{for(let i=live.length-1;i>=0;i--)if(!keep.has(liveKeys[i]))live[i].destroy(false);
        target.forEach((t,i)=>{if(!keep.has(targetKeys[i]))code.createThread(clone(t),i);});return true;});
      if(!done||code.getThreads().map(t=>t.getFirstBlock?.()?.id).join('\n')!==targetKeys.join('\n'))return full();
      orderEvents(code);return 'threads';};
    // ★실패 복구는 작업이 일부 실행된 뒤라 지금 화면이 이미 달라져 있다. 그때는 편집 시작 때의 화면을 넘겨받는다.
    function restore(saved,view={selected:Entry.playground.object?.id||null,scene:Entry.scene.selectedScene?.id}) {
      sm.startIgnore();try {
        for(const {id,model} of saved.objects){let o=Entry.container.getObject(id);if(!model){if(o)Entry.container.removeObject(id);continue;}
          if(o&&JSON.stringify(o.toJSON())===JSON.stringify(model))continue;
          if(!o){const scene=Entry.scene.getSceneById(model.scene);if(!scene)throw Error('RESTORE_SCENE_CHANGED');
            // ★addObjectFunc는 언제나 지금 장면에 넣으므로, 다른 장면 오브젝트는 생성자가 원래 장면 무대에 싣게 한다.
            if(scene.id===Entry.scene.selectedScene.id)Entry.container.addObjectFunc(clone(model),0);else {const back=new Entry.EntryObject(clone(model));Entry.container.objects_.push(back);back.generateView();}
            o=object(id);}else {
            o.setName(model.name);o.pictures=clone(model.sprite.pictures);o.sounds=clone(model.sprite.sounds);
            o.selectedPicture=o.getPicture(model.selectedPictureId);o.entity.injectModel(o.selectedPicture,clone(model.entity));o.setRotateMethod(model.rotateMethod);putThreads(o.script,JSON.parse(model.script));
          }}
        for(const {id,model} of saved.variables){const v=findVariable(id);if(v&&JSON.stringify(v.toJSON())===JSON.stringify(model))continue;if(model)putVariable(model);else if(v){if(v.toJSON().variableType==='list')vc.removeList(v);else vc.removeVariable(v);}}
        for(const {id,model} of saved.messages){const m=vc.getMessage(id);if(m&&model&&m.name===model.name)continue;if(m)vc.removeMessage(m);if(model)vc.addMessage(clone(model));}
        for(const {id,threads,type,localVariables,useLocalVariables} of saved.functions){const f=vc.getFunction(id);
          if(!f){vc.saveFunction(new Entry.Func({id,type,localVariables:clone(localVariables||[]),useLocalVariables,content:JSON.stringify(threads)}));continue;}
          if(JSON.stringify(f.content.toJSON())===JSON.stringify(threads))continue;f.content.destroyView();f.content.load(threads);f.generateBlock(true);vc.saveFunction(f);}
        for(const id of saved.scoped?functionIds:Object.keys(vc.functions_))if(vc.getFunction(id)&&!saved.functions.some(f=>f.id===id)){if(vc.removeFunction)vc.removeFunction(vc.getFunction(id));else delete vc.functions_[id];}
        const sort=(a,order,getId)=>a.sort((x,y)=>order.indexOf(getId(x))-order.indexOf(getId(y)));
        if(!saved.scoped||reordered)sort(Entry.container.objects_,saved.order,o=>o.id);
        if(!saved.scoped||variableIds.length){sort(vc.variables_,saved.variableOrder,v=>v.toJSON().id);sort(vc.lists_,saved.listOrder,v=>v.toJSON().id);}
        if(!saved.scoped||messageIds.length)sort(vc.messages_,saved.messageOrder,m=>m.id);updateViews(view);
      }finally{sm.endIgnore();}
    }
    // ★되돌리기는 편집이 끝난 한참 뒤에 실행되므로 이 편집이 건드린 대상만 되돌린다. 그사이 다른 곳에 생긴 변경을 옛 내용으로 덮으면 안 된다.
    const scoped=saved=>({...saved,scoped:true,objects:saved.objects.filter(o=>objectIds.includes(o.id)),variables:saved.variables.filter(v=>variableIds.includes(v.id)),
      messages:saved.messages.filter(m=>messageIds.includes(m.id)),functions:saved.functions.filter(f=>functionIds.includes(f.id))});
    // ★script.load와 변수·신호 직접 변경은 엔트리 명령을 거치지 않는다. 명령 신호로 바뀐 곳을 찾는 도구(실시간 합작)가 알아채야 옛 내용을 되쓰지 않는다.
    const announce=()=>{for(const id of functionIds)vc.getFunction(id)?.content.changeEvent?.notify();Entry.commander?.doEvent?.notify('entryMcpEdit',[]);};
    const targets=[...objectIds.map(id=>['object',id]),...variableIds.map(id=>['variable',id]),...messageIds.map(id=>['message',id]),...functionIds.map(id=>['function',id])];
    const beforeParts=new Map(targets.map(t=>[t.join(),parts(...t)]));
    const noteEdit=()=>{for(const e of journal)e.checks=e.checks.filter(c=>!targets.some(([k,i])=>k===c.kind&&i===c.id));journal.splice(0,journal.length,...journal.filter(e=>e.checks.length));
      const checks=targets.flatMap(([kind,id])=>{const was=beforeParts.get(`${kind},${id}`),now=parts(kind,id);
        if(!now)return was?[{kind,id,absent:true}]:[];
        const before=was?.map(print)??null,after=now.map(print),roots=kind==='object'?now[0].map(t=>t[0]?.id).filter(r=>r&&!was?.[0].some(t=>t[0]?.id===r)):[];
        return before&&before.every((p,i)=>p===after[i])&&!roots.length?[]:[{kind,id,before,after,roots}];});
      const edit={at:Date.now(),afterHash:null,undone:false,checks};if(checks.length){journal.push(edit);journal.splice(0,Math.max(0,journal.length-30));}return edit;};
    // ★사용자가 함수 편집 화면에 열어 둔 함수를 바꾸면 편집 화면의 블록 그림이 사라지고, 그 뒤 팔레트 끌어 놓기가 엔트리 오류로 막힌다
    if(Entry.Func?.isEdit&&functionIds.includes(String(Entry.Func.targetFunc?.id)))throw Error(`FUNCTION_OPEN_IN_EDITOR: ${Entry.Func.targetFunc.id} is open in the user's function editor; ask the user to close it, then retry`);
    const reverted=revertedEdits();
    // ★스레드만 바뀐 편집은 화면에 그 스레드 그림만 더하고 빼므로, 열린 오브젝트 화면 전체를 다시 그리지 않는다.
    let reinject=operations.some(o=>!['set_script','set_object'].includes(o.action));
    sm.startIgnore();try {
      for(const op of operations) {
        if(op.action==='set_object'){const o=object(op.objectId);for(const [key,value] of Object.entries(op.properties)){
          const setters={x:'setX',y:'setY',size:'setSize',rotation:'setRotation',direction:'setDirection',visible:'setVisible'};
          if(key==='name')o.setName(value);else if(key==='rotateMethod')o.setRotateMethod(value);else if(setters[key])o.entity[setters[key]](value);else throw Error(`UNKNOWN_OBJECT_PROPERTY: ${key}`);}o.updateCoordinateView();
          // ★이름 바꾸기 명령과 같은 길: 목록 글자만 바뀌므로 열린 오브젝트의 코드 화면 제목은 따로 고친다.
          if('name' in op.properties&&Entry.playground.object===o)Entry.playground.updateObjectTitle?.(o);}
        else if(op.action==='set_script'){const o=object(op.objectId),onBoard=Entry.getMainWS?.()?.board?.code===o.script;if(putThreads(o.script,op.threads)==='full'&&onBoard)reinject=true;}
        else if(op.action==='set_function'){const f=vc.getFunction(op.functionId);f.content.destroyView();f.content.load(op.threads);f.generateBlock(true);vc.saveFunction(f);}
        else if(op.action==='create_function'){const m=op.model;
          const func=new Entry.Func({id:m.id,type:m.type,localVariables:clone(m.localVariables),useLocalVariables:m.localVariables.length>0,content:JSON.stringify(m.threads)});
          // ★Entry.Func 생성자가 이미 블록 메뉴에 등록하므로 registerFunction을 또 부르면 메뉴에 같은 블록이 두 번 생긴다.
          func.generateBlock?.(true);vc.saveFunction(func);}
        else if(op.action==='remove_function'){const f=vc.getFunction(op.functionId);if(vc.removeFunction)vc.removeFunction(f);else{f.destroy?.();delete vc.functions_[op.functionId];}}
        else if(op.action==='add_object')Entry.container.addObjectFunc(clone(op.model),0);
        else if(op.action==='remove_object')Entry.container.removeObject(op.objectId);
        else if(op.action==='order_objects'){const objects=Entry.container.getCurrentObjects();if(objects.length!==op.objectIds.length||new Set(op.objectIds).size!==objects.length||objects.some(o=>!op.objectIds.includes(o.id)))throw Error('ORDER_REQUIRES_EVERY_CURRENT_SCENE_OBJECT_ONCE');op.objectIds.forEach((id,i)=>{const j=Entry.container.getCurrentObjects().findIndex(o=>o.id===id);if(i!==j)Entry.container.moveElement(i,j);});}
        else if(op.action==='upsert_variable'){putVariable(op.model);stay(original);}
        else if(op.action==='upsert_message'){const m=vc.getMessage(op.id);if(m)m.name=op.name;else vc.addMessage({id:op.id,name:op.name});}
        else if(op.action==='remove_variable'){const v=findVariable(op.id);if(v.toJSON().variableType==='list')vc.removeList(v);else vc.removeVariable(v);}
        else if(op.action==='remove_message')vc.removeMessage(vc.getMessage(op.id));
        else if(op.action==='set_pictures'){const o=object(op.objectId);o.pictures=clone(op.pictures);o.selectedPicture=o.getPicture(op.selectedPictureId || op.pictures[0].id);if(!o.selectedPicture)throw Error('SELECTED_PICTURE_NOT_FOUND');o.entity.setImage(o.selectedPicture);Entry.playground.injectPicture(o);}
        else if(op.action==='set_sounds'){const o=object(op.objectId),selectedId=o.selectedSound?.id;o.sounds=clone(op.sounds);o.sounds.forEach(s=>Entry.initSound(s));
          o.selectedSound=o.sounds.find(s=>s.id===selectedId)||o.sounds[0];if(Entry.playground.object===o)Entry.playground.injectSound();}
        else throw Error(`UNKNOWN_EDIT_ACTION: ${op.action}`);
      }
      // ★지운 변수·신호를 남은 코드(오브젝트 스크립트·함수)가 아직 쓰면 깨진 블록이 남으므로 거부한다.
      const removedIds=operations.filter(o=>['remove_variable','remove_message'].includes(o.action)).map(o=>o.id).concat(operations.flatMap(o=>o.removedSoundIds||[]));
      // ★작품 전체 코드를 글 하나로 만들지 않고 오브젝트·함수마다 따로 글로 바꿔 찾는다(큰 작품 탭 메모리)
      const stillUsed=needles=>{const codes=function*(){for(const o of Entry.container.getAllObjects())yield o.script.toJSON();for(const id of Object.keys(vc.functions_))yield vc.getFunction(id).content.toJSON();};
        for(const code of codes()){const text=JSON.stringify(code);const hit=needles.find(n=>text.includes(JSON.stringify(n)));if(hit!==undefined)return hit;}return undefined;};
      if(removedIds.length){const rid=stillUsed(removedIds);if(rid!==undefined)throw Error(`STILL_IN_USE: ${rid}`);}
      const removedFns=operations.filter(o=>o.action==='remove_function').map(o=>o.functionId);
      if(removedFns.length){const fn=stillUsed(removedFns.map(fid=>'func_'+fid));if(fn!==undefined)throw Error(`STILL_IN_USE: ${fn}`);}
      updateViews(original,reinject);
    }catch(error){sm.endIgnore();restore(original,original);return {applied:false,error:String(error.message),rolledBack:same(exported(),before),revertedEdits:reverted};}
    sm.endIgnore();const after=exported();
    // ★버전은 await 전에 잰다. 그 뒤에 사용자가 고친 것까지 이 편집 결과로 섞지 않는다.
    const versions=Object.fromEntries([...objectIds.flatMap(id=>['script','pictures','sounds'].map(k=>`${k}:${id}`)),...functionIds.map(id=>`function:${id}`)].map(k=>[k,version(k)]).filter(([,v])=>v));
    const paths=(a,b,p='')=>{if(same(a,b))return [];if(!a||!b||typeof a!=='object'||typeof b!=='object')return [p || '/'];return [...new Set([...Object.keys(a),...Object.keys(b)])].flatMap(k=>paths(a[k],b[k],`${p}/${k}`));};
    const changed=paths(before,after);
    const reordered=operations.some(o=>['add_object','remove_object','order_objects'].includes(o.action));
    // ★배열 재정렬은 인덱스 diff 대신 ID로 비교한다. 대상 밖 데이터는 그대로여야 한다.
    const untouched=(section,affected)=>{const a=before[section]||[],b=after[section]||[];return a.filter(x=>!affected.includes(x.id)).some(x=>!same(x,b.find(y=>y.id===x.id)))||b.some(x=>!affected.includes(x.id)&&!a.some(y=>y.id===x.id));};
    const unexpected=[];
    if(untouched('objects',objectIds))unexpected.push('objects outside operations');
    // ★편집기에 없는 변수는 EntryRoot 저장 변환이 내보낼 때마다 다시 계산하는 리스트다 — 대상 밖 변경으로 보지 않는다.
    const liveVariableIds=new Set([...original.variables.filter(v=>v.model).map(v=>v.id),...[...vc.variables_,...vc.lists_].map(v=>v.toJSON().id)]);
    const derivedVariableIds=[...(before.variables||[]),...(after.variables||[])].map(v=>v.id).filter(id=>!liveVariableIds.has(id));
    if(untouched('variables',[...variableIds,...derivedVariableIds]))unexpected.push('variables outside operations');
    if(untouched('messages',messageIds))unexpected.push('messages outside operations');
    if(untouched('functions',functionIds))unexpected.push('functions outside operations');
    // ★선택 중인 오브젝트를 지우면 선택이 다른 오브젝트로 옮겨 가는 것이 당연하다.
    const selectedRemoved=operations.some(o=>o.action==='remove_object'&&o.objectId===original.selected);
    for(const k of Object.keys(before))if(!['objects','variables','messages','functions'].includes(k)&&!(k==='interface'&&selectedRemoved)&&!same(before[k],after[k]))unexpected.push(k);
    if(!reordered&&before.objects.map(o=>o.id).join()!==after.objects.map(o=>o.id).join())unexpected.push('object order');
    for(const id of objectIds) {
      const a=before.objects.find(o=>o.id===id),b=after.objects.find(o=>o.id===id);if(!a||!b)continue;
      const relevant=operations.filter(o=>o.objectId===id),allowed=[];
      for(const op of relevant){
        if(op.action==='set_script')allowed.push('/script');
        if(op.action==='set_sounds')allowed.push('/sprite/sounds');
        if(op.action==='set_pictures')allowed.push('/sprite/pictures','/selectedPictureId','/entity/width','/entity/height','/entity/regX','/entity/regY','/entity/scaleX','/entity/scaleY');
        if(op.action==='set_object')for(const k of Object.keys(op.properties)){
          if(k==='name')allowed.push('/name');else if(k==='rotateMethod')allowed.push('/rotateMethod','/entity/rotation');
          else if(k==='size')allowed.push('/entity/scaleX','/entity/scaleY');else allowed.push(`/entity/${k}`);
        }
      }
      for(const p of paths(a,b))if(!allowed.some(prefix=>p===prefix||p.startsWith(prefix+'/')))unexpected.push(`${id}${p}`);
    }
    if(unexpected.length){restore(original,original);return {applied:false,unexpectedChanges:unexpected,rolledBack:same(exported(),before),revertedEdits:reverted};}
    function swap(saved,edit){stopped();const inverse=scoped(readState());restore(saved);announce();edit.undone=!edit.undone;const command=sm.addCommand('entry-mcp-edit',null,swap,inverse,edit);return {isPass(value){command.isPass=value;return this;}};}
    // ★엔트리 되돌리기 목록은 크기 제한이 없다. 바뀐 게 없으면 넣지 않고, MCP 항목은 마지막 하나만 남긴다.
    if(!changed.length)return {applied:true,afterHash:await digest(after,true),versions,changedCount:0,changedPaths:[],undoable:false,unexpectedChanges:[],revertedEdits:reverted};
    sm.undoStack_=sm.undoStack_.filter(c=>c.message!=='entry-mcp-edit');
    // ★addCommand가 변경 알림을 내보내므로 그 전에 announce해야 듣는 쪽이 전체를 다시 읽는다. 기록도 await 앞에서 끝내야 끼어든 변경이 섞이지 않는다.
    const edit=noteEdit();announce();sm.addCommand('entry-mcp-edit',null,swap,scoped(original),edit);
    const afterHash=await digest(after,true);edit.afterHash=afterHash;
    return {applied:true,afterHash,versions,changedCount:changed.length,changedPaths:changed.slice(0,100),undoable:true,unexpectedChanges:[],revertedEdits:reverted};
  }catch(error){return {__entryMcpError:String(error?.message || error)};}
}
