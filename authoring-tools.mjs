import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { basename, extname, isAbsolute } from 'node:path';
import * as z from 'zod/v4';

export const ENTRY_INSTRUCTIONS = `You control an already-open Entry editor through these MCP tools. No Entry source code, browser debugger, JavaScript evaluation, or filesystem checkpoint reading is required.
Start with entry_help, entry_tabs, entry_select_tab, then entry_context. If running, use entry_control(action:"stop") before editing. entry_context returns IDs and per-target versions.
The user may keep editing the same project while you work. There is no whole-project hash: block patches, inserts, object properties, variables and signals apply to the live editor state at the moment of the edit. Operations that replace a whole list (set_script, set_function, set_pictures, set_sounds) need expectedVersions for that target, e.g. {"script:<objectId>": versions.script from entry_context or version from entry_script}; if the user changed that target since you read it, the edit is refused with TARGET_CHANGED instead of overwriting their work. Prefer patch_blocks/insert_blocks over set_script so the user's edits in other threads survive. Block-level operations have no per-block check: if the user changed the same block field after you read it, your value wins, so re-read with entry_script right before patching a block the user may be touching. Moving a thread changes the script version, so set_script may be refused while the user arranges that object.
Read code with entry_script. Discover native and installed-plugin blocks with entry_block_schema. New blocks use {type, fields:{NAME:value}, statements:[[]]}; field names and dropdown values come from the live schema. Nested blocks are ordinary values. Keep existing IDs when modifying existing code.
entry_edit applies a batch atomically, creates a backup, validates blocks before writing, checks that nothing outside the operations changed during the edit, and adds native Undo. Use patch_blocks to change individual blocks and insert_blocks to put new blocks before/after an existing block without copying a large script. TARGET_CHANGED or BLOCK_NOT_FOUND means the user changed that part: re-read it, never retry blindly.
Use entry_control and entry_state to observe execution, and entry_preview to SEE the stage. Inspect the visual result, not just numeric checks. A checkpoint is local backup, not online save or reload proof. Preserve user-authored logic/assets and do not change animation timing or geometry unless requested.
An applied edit can still be undone later by the user or a real-time collaboration reload. entry_context, entry_edit and entry_checkpoint report such earlier edits in revertedEdits; re-read before deciding whether to apply them again.
entry_edit status PENDING means the page is still applying that edit, it is still waiting behind another edit, or the connection closed after it was sent: never resend it. entry_context.lastEdits shows its requestId with applied true or false once the page finishes. If the requestId never appears, compare against the returned checkpoint with entry_diff_checkpoint before editing again.
Every tool describes its arguments. entry_help contains runnable examples and recovery steps. Connection or missing capability errors must be reported literally; do not pretend a successful code write proves the user-visible result.`;

export const GUIDE = {
  workflow:['entry_tabs → entry_select_tab','entry_context (stop with entry_control if necessary)',
    'entry_script / entry_block_schema','entry_edit (expectedVersions only for whole-list replacements)','entry_control start → entry_state / entry_preview → entry_control stop','entry_diff_checkpoint'],
  blockFormat:{type:'move_x',fields:{VALUE:10},statements:[]},
  examples:{
    changePosition:{operations:[{action:'set_object',objectId:'COPY context.objects[].id',properties:{x:0,y:0}}]},
    addMovementThread:{operations:[{action:'patch_blocks',objectId:'COPY object ID',appendThreads:[[{type:'when_run_button_click',fields:{}},{type:'move_x',fields:{VALUE:10}}]]}]},
    changeOneInput:{operations:[{action:'patch_blocks',objectId:'COPY object ID',patches:[{blockId:'COPY entry_script block ID',fields:{VALUE:20}}]}]},
    insertAfterBlock:{operations:[{action:'insert_blocks',objectId:'COPY object ID',inserts:[{afterBlockId:'COPY entry_script statement block ID',blocks:[{type:'move_x',fields:{VALUE:5}}]}]}]},
    newObject:{operations:[{action:'add_object',id:'my_object',name:'새 오브젝트',templateObjectId:'COPY existing object ID with pictures'}]},
    newList:{operations:[{action:'upsert_variable',model:{id:'my_list',name:'값 목록',variableType:'list',visible:false,array:[{data:'1'},{data:'2'}]}}]},
    signal:{operations:[{action:'upsert_message',id:'my_signal',name:'시작 신호'}]},
    replaceScript:{expectedVersions:{'script:COPY object ID':'COPY context.objects[].versions.script or entry_script.version'},operations:[{action:'set_script',objectId:'COPY object ID',threads:'COPY full threads from entry_script'}]},
    pictures:'entry_upload_asset(path: user-authorized local image) returns a picture model. Read existing object pictures with entry_project, then set_pictures with the complete preserved list plus the new model and expectedVersions {"pictures:<objectId>": context.objects[].versions.pictures}.',
    sounds:'entry_upload_sound(path: user-authorized local .mp3) returns a sound model. Read existing object sounds with entry_project, then set_sounds with the complete preserved list plus the new model and expectedVersions {"sounds:<objectId>": context.objects[].versions.sounds}; point get_sounds blocks at the new id with patch_blocks.'},
  recovery:{EDITOR_RUNNING:'entry_control(action:"stop"), then entry_context',TARGET_CHANGED:'The user (or another tool) changed that script, function, picture list or sound list after you read it. Re-read it (entry_script / entry_context), rebuild the edit on the new content, and use the new version. Never resend the old one.',
    VERSION_REQUIRED:'set_script, set_function, set_pictures and set_sounds replace a whole list, so pass expectedVersions with the key named in the error (versions from entry_context or entry_script). For small changes use patch_blocks / insert_blocks instead.',
    BLOCK_NOT_FOUND:'The block ID no longer exists, often because the user deleted or replaced it. Re-read with entry_script.',
    UNKNOWN_BLOCK_TYPE:'entry_block_schema(query: a type-name fragment) then entry_block_schema(type: exact name)',UNKNOWN_BLOCK_FIELD:'Use the returned paramsKeyMap; do not guess array positions',
    BRIDGE_NOT_CONNECTED:'Enable/reload the paired Personal Entry MCP Bridge in the usual Chrome profile; do not open a special debug Chrome',
    UNKNOWN_ENTRY_ACTION:'The running Chrome extension is older than the server. Reload Personal Entry MCP Bridge once in Chrome, then reconnect.',
    AUTHORING_UNAVAILABLE:'Reload the Personal Entry MCP Bridge extension after an update, then reconnect the MCP client',
    NO_MATCHING_DISCRIMINATOR:'entry_edit rejected an action listed in entry_help: this MCP server process started before the update. Reconnect the MCP client; if the server process start time did not change, end that session\'s server_bridge process so the next call starts a fresh one, then entry_select_tab again.',
    EDIT_STILL_RUNNING:'The page is still applying that edit, or it is still waiting behind another edit. Do not resend it. Wait a few seconds, then entry_context: lastEdits lists the requestId with applied true or false; if its state is running, wait again. If the requestId is missing even though entry_context answers, the edit never reached the page or the tab reloaded: entry_diff_checkpoint against the returned checkpoint shows whether anything changed; only then decide whether to edit again.',
    EDIT_CONNECTION_LOST:'The bridge connection closed after the edit was sent, so the page may still apply it. Do not resend it. Reconnect with entry_tabs and entry_select_tab, then follow EDIT_STILL_RUNNING.',
    BRIDGE_MESSAGE_TOO_LARGE:'The project is larger than one bridge message may carry (default 256 MiB). Nothing was changed. Report the size to the user; raising ENTRY_MCP_MAX_MESSAGE_MIB and restarting the MCP server lifts the limit.',
    BRIDGE_TIMEOUT:'The page did not answer in time, often because a long edit is still running there. Wait a few seconds and call entry_context; check lastEdits before retrying any edit.',
    revertedEdits:'cause "undo" means Ctrl+Z or the undo button removed your edit: ask the user before re-applying. cause "external" means another tool or a whole-project reload replaced it: entry_context, re-read the listed items, then re-apply only what is still wanted.'},
  limits:['Edits require a stopped editor.','add_object and order_objects use the current scene; call entry_control(action:"select_scene", sceneId) first for another scene. remove_object works on any scene.','add_object copies pictures, not scripts or private plugin state.',
    'Function-body edits preserve the existing function signature; create_function adds a new function with round slots.','Uploaded images and sounds go only to the signed-in Entry account when the user authorizes that upload.',
    'Online save/reopen is not certified by a local checkpoint or an edit result.'],
};

const id=z.string().min(1).max(200);
const versions=z.record(z.string().regex(/^(script|function|pictures|sounds):.+$/),z.string().min(1)).describe('Per-target versions you read: keys "script:<objectId>", "function:<functionId>", "pictures:<objectId>", "sounds:<objectId>"; values from entry_context (objects[].versions, functions[].version) or entry_script.version. Required for every set_script/set_function/set_pictures/set_sounds target; optional for others. A mismatch refuses the whole batch with TARGET_CHANGED.');
const threads=z.array(z.array(z.record(z.string(),z.unknown())));
const properties=z.object({name:z.string().min(1).max(100).optional(),x:z.number().finite().optional(),y:z.number().finite().optional(),
  size:z.number().positive().optional(),rotation:z.number().finite().optional(),direction:z.number().finite().optional(),visible:z.boolean().optional(),rotateMethod:z.enum(['free','vertical','none']).optional()}).strict();
const operation=z.discriminatedUnion('action',[
  z.object({action:z.literal('set_object'),objectId:id,properties}),
  z.object({action:z.literal('set_script'),objectId:id,threads}),
  z.object({action:z.literal('patch_blocks'),objectId:id,patches:z.array(z.object({blockId:id,fields:z.record(z.string(),z.unknown())})).default([]),appendThreads:threads.default([])}),
  z.object({action:z.literal('insert_blocks'),objectId:id,inserts:z.array(z.object({afterBlockId:id.optional(),beforeBlockId:id.optional(),
    blocks:z.array(z.record(z.string(),z.unknown())).min(1)}).refine(a=>Boolean(a.afterBlockId)!==Boolean(a.beforeBlockId),'Specify exactly one afterBlockId or beforeBlockId')).min(1)
    .describe('Put new statement blocks right after or before an existing statement block (top level or inside an if/else or loop branch) without resending the whole script. Inserts apply in order; IDs come from entry_script.')}),
  z.object({action:z.literal('set_function'),functionId:id,threads}),
  z.object({action:z.literal('create_function'),model:z.object({id,type:z.enum(['normal','value']).default('normal'),
    localVariables:z.array(z.object({id,name:z.string().min(1),value:z.union([z.string(),z.number()]).default(0)})).default([]),threads})
    .describe('New native function. threads[0][0] is function_create whose header chains function_field_label / function_field_string (round slot; its param block type is a new unique stringParam_<id>). Body reads a slot with {type:"stringParam_<id>"} and local variables with get_func_variable/set_func_variable. The function id must not contain "_" and every local variable id must be <functionId>_<suffix>: Entry finds the function from the text before the first "_".')}),
  z.object({action:z.literal('remove_function'),functionId:id.describe('Rejected with STILL_IN_USE while any object script or function still calls func_<id>; remove the callers in the same batch')}),
  z.object({action:z.literal('add_object'),id,name:z.string().min(1).max(100),templateObjectId:id}),
  z.object({action:z.literal('remove_object'),objectId:id}),
  z.object({action:z.literal('order_objects'),objectIds:z.array(id).min(1)}),
  z.object({action:z.literal('upsert_variable'),model:z.object({id,name:z.string().min(1),variableType:z.enum(['variable','list']),
    visible:z.boolean().default(false),object:id.optional(),value:z.union([z.string(),z.number(),z.boolean()]).default(0),array:z.array(z.object({data:z.union([z.string(),z.number(),z.boolean()])})).optional()})}),
  z.object({action:z.literal('upsert_message'),id,name:z.string().min(1).max(100)}),
  // ★지우기 3종: 남은 코드가 지운 변수·신호를 아직 쓰면 확장 쪽에서 거부하고 되돌린다.
  z.object({action:z.literal('remove_threads'),objectId:id,threadIds:z.array(id).min(1).describe('Root (first) block IDs of the threads to delete')}),
  z.object({action:z.literal('remove_variable'),id}),
  z.object({action:z.literal('remove_message'),id}),
  z.object({action:z.literal('set_pictures'),objectId:id,pictures:z.array(z.record(z.string(),z.unknown())).min(1),selectedPictureId:id.optional()}),
  z.object({action:z.literal('set_sounds'),objectId:id,sounds:z.array(z.record(z.string(),z.unknown()))
    .describe('Complete new sound list for the object. Rejected with STILL_IN_USE while that object script still references a removed sound id.')}),
]);
const operations=z.array(operation).min(1).max(50);
// ★MCP 클라이언트가 도구 하나를 기다리는 시간(흔히 60초)보다 짧아야 진행 중 답을 돌려줄 수 있다.
const EDIT_TIMEOUT_MS=Math.min(Math.max(Number(process.env.ENTRY_MCP_EDIT_TIMEOUT_MS)||45000,1000),120000);
// ★큰 그림 목록·스크립트는 도구 호출 글자로 옮기다 깨지기 쉬워 파일로 받는다. 파일 내용도 operations와 같은 검사를 거친다.
async function readOperations(path) {
  if(!isAbsolute(path))throw Error('ABSOLUTE_OPERATIONS_PATH_REQUIRED');if(extname(path).toLowerCase()!=='.json')throw Error('OPERATIONS_JSON_REQUIRED');
  const text=await readFile(path,'utf8');if(text.length>32*1024*1024)throw Error('OPERATIONS_FILE_TOO_LARGE: maximum 32 MiB');
  try{return JSON.parse(text);}catch(error){throw Error(`OPERATIONS_JSON_INVALID: ${error.message}`);}
}

export function registerAuthoringTools(server,{bridge,guarded,project,checkpoint}) {
  const read=(name,description,inputSchema,method)=>server.registerTool(name,{description,inputSchema,annotations:{readOnlyHint:true}},
    guarded(async args=>({status:'PASS',...(await bridge.request(method,args))})));
  server.registerTool('entry_help',{description:'START HERE. Complete self-contained Entry MCP guide, supported edits, runnable examples, and error recovery. No prior Entry knowledge needed.',inputSchema:z.object({}),annotations:{readOnlyHint:true}},guarded(async()=>({status:'PASS',instructions:ENTRY_INSTRUCTIONS,...GUIDE})));
  read('entry_context','Get editor state, scene/object/variable/function/message IDs and per-target versions (objects[].versions, functions[].version) used by entry_edit expectedVersions. Call this before editing.',z.object({}),'context');
  read('entry_script','Read LIVE authoring code, including installed plugin blocks. Returns versionKey and version for entry_edit expectedVersions. Default summary lists thread roots and block IDs; threadIndex or blockId reads a subtree. Use patch_blocks for small edits; do not copy a truncated subtree as a whole script.',
    z.object({objectId:id.optional(),functionId:id.optional(),threadIndex:z.number().int().nonnegative().optional(),blockId:id.optional(),depth:z.number().int().min(1).max(20).default(4),offset:z.number().int().nonnegative().default(0),limit:z.number().int().min(1).max(50).default(10)}).refine(a=>Boolean(a.objectId)!==Boolean(a.functionId),'Specify exactly one objectId or functionId'),'script');
  read('entry_state','Observe current runtime positions, visibility, scale, and costume indices without stopping the game.',z.object({}),'state');
  server.registerTool('entry_control',{description:'Use normal Entry start/stop/pause/resume controls. stop also handles paused games. select_scene switches the open scene in the stopped editor, which moves the user\'s view too. Does not edit saved code.',
    inputSchema:z.object({action:z.enum(['start','stop','pause','resume','select_scene']),sceneId:id.optional()}).refine(a=>a.action!=='select_scene'||a.sceneId,'select_scene requires sceneId from entry_context.scenes')},guarded(async args=>({status:'PASS',...(await bridge.request('control',args))})));
  server.registerTool('entry_preview',{description:'SEE the current Entry stage as an image, with runtime state. Use this to judge visual changes and overlap; numeric checks alone cannot establish the appearance.',inputSchema:z.object({}),annotations:{readOnlyHint:true}},async()=>{
    try{const r=await bridge.request('preview');return {content:[{type:'text',text:JSON.stringify({status:'PASS',state:r.state})},{type:'image',mimeType:'image/png',data:r.dataUrl.split(',')[1]}]};}
    catch(e){return {isError:true,content:[{type:'text',text:JSON.stringify({status:'BLOCKED',error:String(e.message),nextStep:'Call entry_context to check the selected tab and bridge version.'})}]};}
  });
  server.registerTool('entry_edit',{description:'Atomically edit the STOPPED current project while the user may be editing other parts at the same time. Supports named block fields, individual block patches, native functions, object properties/order/create/remove, variables/lists/signals, picture and sound models. Automatically backs up, validates, checks that nothing outside the operations changed during the edit, and provides native Undo. Whole-list replacements (set_script, set_function, set_pictures, set_sounds) need expectedVersions; other operations apply to the live state. Existing logic/assets outside the operations must stay unchanged. Several operations on one existing object in a batch apply in order, each on the previous result. revertedEdits lists earlier applied edits that were undone since.',
    inputSchema:z.object({expectedVersions:versions.optional(),operations:operations.optional().describe('A single atomic batch; use entry_help for examples.'),
      operationsPath:z.string().min(1).optional().describe('Absolute path to a local .json file holding the same operations array, for large picture lists or scripts; validated exactly like operations.')})
      .refine(a=>Boolean(a.operations)!==Boolean(a.operationsPath),'Specify exactly one operations or operationsPath')},guarded(async args=>{
      const ops=args.operationsPath?operations.parse(await readOperations(args.operationsPath)):args.operations;
      // 백업은 편집 요청 직전에 따로 받는다. 그 뒤 사용자가 고친 것은 백업에 없으므로, 이 백업과의 비교·불러오기에는 사용자 변경도 섞인다.
      const saved=await checkpoint(await project()),requestId=randomUUID();let result;
      try{result=await bridge.request('edit',{...(args.expectedVersions?{expectedVersions:args.expectedVersions}:{}),operations:ops,requestId},{timeoutMs:EDIT_TIMEOUT_MS});}
      // ★탭 확인·선택에서 난 시간 초과는 편집이 페이지에 가지도 않은 것이라 진행 중이 아니다. 보낸 뒤 연결이 끊긴 것은 페이지에서 계속 돌 수 있다.
      catch(error){const message=String(error?.message||error),lost=/^BRIDGE_DISCONNECTED\b/.test(message);
        if(!lost&&!/^BRIDGE_TIMEOUT: edit\b/.test(message))throw error;
        return {status:'PENDING',reason:lost?'EDIT_CONNECTION_LOST':'EDIT_STILL_RUNNING',requestId,checkpoint:saved,
          nextStep:`${lost?'The connection closed after this edit was sent':`No answer after ${EDIT_TIMEOUT_MS/1000}s`}; the page may still be applying it. Do not resend it. ${lost?'Reconnect (entry_tabs, entry_select_tab), then c':'C'}all entry_context and find requestId ${requestId} in lastEdits; if it is missing, entry_diff_checkpoint with checkpointHash ${saved?.hash} shows what changed.`};}
      return {status:result.applied?'PASS':'FAIL',requestId,checkpoint:saved,...result,persistence:'editor model and local backup; online save/reopen not verified'};
    }));
  server.registerTool('entry_undo',{description:'Undo or redo only the last native MCP edit; refuse when a user action is newer on the undo stack. Restores only the targets of that edit without reloading the whole project.',
    inputSchema:z.object({action:z.enum(['undo','redo']).default('undo')})},guarded(async args=>({status:'PASS',...(await bridge.request('undo',args))})));
  server.registerTool('entry_upload_asset',{description:'Upload one user-authorized local PNG/JPEG/WebP/SVG image to the signed-in Entry account and return a ready-to-use picture model. Add it with entry_edit/set_pictures. Does not change any object by itself.',
    inputSchema:z.object({path:z.string().min(1).describe('Absolute path to the specific local image the user authorized for this Entry project.')})},guarded(async({path})=>{
      const types={'.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.svg':'image/svg+xml'},mimeType=types[extname(path).toLowerCase()];
      if(!isAbsolute(path))throw Error('ABSOLUTE_IMAGE_PATH_REQUIRED');if(!mimeType)throw Error('IMAGE_TYPE_REQUIRED');const bytes=await readFile(path);if(bytes.length>5*1024*1024)throw Error('IMAGE_TOO_LARGE: maximum 5 MiB');
      return {status:'PASS',picture:await bridge.request('upload',{filename:basename(path),mimeType,base64:bytes.toString('base64')})};
    }));
  server.registerTool('entry_upload_sound',{description:'Upload one user-authorized local MP3 to the signed-in Entry account through the same endpoint as the editor sound popup and return a ready-to-use sound model. Entry re-encodes it server-side, so read the returned duration. Add it with entry_edit/set_sounds. Does not change any object by itself.',
    inputSchema:z.object({path:z.string().min(1).describe('Absolute path to the specific local .mp3 the user authorized for this Entry project.')})},guarded(async({path})=>{
      // The editor popup only accepts .mp3 names up to 10 MiB for sounds.
      if(!isAbsolute(path))throw Error('ABSOLUTE_SOUND_PATH_REQUIRED');if(extname(path).toLowerCase()!=='.mp3')throw Error('MP3_REQUIRED');
      const bytes=await readFile(path);if(bytes.length>10*1024*1024)throw Error('SOUND_TOO_LARGE: maximum 10 MiB');
      return {status:'PASS',sound:await bridge.request('upload_sound',{filename:basename(path),base64:bytes.toString('base64')})};
    }));
}
