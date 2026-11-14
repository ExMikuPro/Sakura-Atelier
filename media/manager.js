'use strict';
(() => {
  const vscode = acquireVsCodeApi();
  const $ = id => document.getElementById(id);
  const send = (type, data = {}) => vscode.postMessage({ type, ...data });
  const languages = ['go','rust','python','typescript','javascript','node','c','cpp','csharp','java'];
  const languageName = {go:'Go / Golang',rust:'Rust',python:'Python',typescript:'TypeScript',javascript:'JavaScript',node:'Node.js',c:'C',cpp:'C++',csharp:'C#',java:'Java'};
  let state, draft, tools = [], selected, selectedTool, mode = 'configurations', dirty = false, sdkMode = 'search', sdkPackages = [], sdkDetails;
  const uuid = () => crypto.randomUUID();
  function el(tag, text, className) { const node = document.createElement(tag); if (text !== undefined) node.textContent = text; if (className) node.className = className; return node; }
  function button(text, action, icon, primary = false) { const node = el('button'); if(icon){const span=el('span',undefined,`codicon codicon-${icon}`);span.setAttribute('aria-hidden','true');node.append(span);} if(text)node.append(document.createTextNode(text));node.className=(icon?'icon-button ':'')+(primary?'primary':'');node.onclick=action;return node; }
  function notice(text,error=false){$('status').textContent=text;$('status').className=`status${error?' error':''}`;}
  function value(){return draft?.configurations.find(c=>c.id===selected);}
  function base(language){return {id:uuid(),name:`${languageName[language]||language} application`,language,kind:['rust','csharp'].includes(language)?'project':'file',target:['rust','csharp'].includes(language)?'.':state.file,cwd:state.root,toolchain:'',args:[],buildArgs:[],env:{},preLaunchTask:'',terminal:true,autoActivate:true,operation:'run',profile:'debug',standard:'',sources:[],includePaths:[],libraryPaths:[],linkArgs:[],output:'',package:'',binary:'',example:'',features:[],rustToolchain:'',cargoTarget:'',packageManager:'npm',script:'',typescriptRunner:'tsx',framework:'',launchProfile:'',goToolchain:'',debugName:'',debugType:'',classPath:[],modulePath:[]};}
  function mark(){dirty=true;notice('Unsaved changes');}
  function flush(){
    if(mode!=='configurations')return true;
    const current=value();if(!current)return true;
    try{for(const input of document.querySelectorAll('[data-field]')){const key=input.dataset.field;current[key]=input.dataset.json?JSON.parse(input.value|| (key==='env'?'{}':'[]')):input.type==='checkbox'?input.checked:input.value;}return true;}
    catch(error){notice(`Invalid JSON field: ${error.message}`,true);return false;}
  }
  function field(container,key,label,opts={}){
    const c=opts.object||value();const wrap=el('div',undefined,`field${opts.wide?' wide':''}`);const labelNode=el('label',label);labelNode.htmlFor=`field-${key}`;wrap.append(labelNode);
    let input;
    if(opts.options){input=el('select');for(const choice of opts.options){const [v,text]=Array.isArray(choice)?choice:[choice,choice];const option=el('option',text);option.value=v;input.append(option);}input.value=c[key]||'';}
    else{input=el(opts.json||opts.multiline?'textarea':'input');input.value=opts.json?JSON.stringify(c[key]??(key==='env'?{}:[]),null,2):c[key]||'';if(opts.readonly)input.readOnly=true;}
    input.id=`field-${key}`;if(!opts.object){input.dataset.field=key;if(opts.json)input.dataset.json='1';}
    input.oninput=()=>{if(opts.object){c[key]=input.value;}mark();if(key==='name'){c.name=input.value;renderList();}};
    if(opts.options){input.onchange=()=>{if(!flush())return;c[key]=input.value;mark();if(key==='language'&&['rust','csharp'].includes(c.language)&&c.kind==='file'){c.kind='project';c.target='.';}if(opts.rerender)renderMain();};}
    if(opts.browse){const picker=el('div',undefined,'picker');picker.append(input,button('Browse...',()=>send('browse',{field:opts.object?'tcPath':key,directory:opts.directory===true}),'folder-opened'));wrap.append(picker);}else{wrap.append(input);}
    if(opts.hint)wrap.append(el('div',opts.hint,'hint'));container.append(wrap);return input;
  }
  function check(container,key,label){const wrap=el('label',undefined,'check');const input=el('input');input.type='checkbox';input.checked=!!value()[key];input.dataset.field=key;input.onchange=mark;wrap.append(input,document.createTextNode(label));container.append(wrap);}
  function shell(){
    const app=$('app');app.replaceChildren();
    const header=el('header');const row=el('div',undefined,'top-row');const title=el('div');title.append(el('h1','Run / Debug Configurations'),el('p','Sakura Atelier · one configuration for running, debugging and testing'));
    const workspace=el('select',undefined,'workspace');workspace.setAttribute('aria-label','Workspace');workspace.id='workspace';workspace.onchange=()=>{if(dirty){notice('Apply or Cancel your changes before switching workspaces.',true);workspace.value=state.folder;return;}send('workspace',{folder:workspace.value});};row.append(title,workspace);header.append(row);
    const tabs=el('nav',undefined,'tabs');for(const [id,label]of [['configurations','Configurations'],['toolchains','Toolchains'],['sdk','SDK Manager']]){const tab=button(label,()=>{if(flush()){mode=id;render();}},id==='sdk'?'package':id==='toolchains'?'tools':'settings-gear');tab.dataset.mode=id;tabs.append(tab);}header.append(tabs);app.append(header);
    const layout=el('div',undefined,'layout');layout.append(el('aside',undefined),el('main'));layout.firstChild.id='list';layout.lastChild.id='main';app.append(layout);
    const footer=el('footer');const status=el('div','Loading…','status');status.id='status';const controls=el('div',undefined,'buttons');controls.append(button('Cancel',()=>send('cancel')),button('Apply',()=>save(false)),button('Save',()=>save(true),undefined,true));footer.append(status,controls);app.append(footer);
  }
  function render(){if(!state)return;const workspace=$('workspace');workspace.replaceChildren();for(const w of state.workspaces){const option=el('option',w.name);option.value=w.uri;workspace.append(option);}workspace.value=state.folder;for(const tab of document.querySelectorAll('[data-mode]'))tab.classList.toggle('active',tab.dataset.mode===mode);renderList();renderMain();}
  function addConfiguration(){if(!flush())return;const c=base(state.language);draft.configurations.push(c);selected=c.id;mode='configurations';mark();render();}
  function renderList(){
    const list=$('list');list.replaceChildren();
    if(mode==='configurations'){
      const bar=el('div',undefined,'toolbar');bar.append(button('Add',addConfiguration,'add'),button('Copy',()=>{if(!flush()||!value())return;const c=JSON.parse(JSON.stringify(value()));c.id=uuid();c.name+=' (copy)';draft.configurations.push(c);selected=c.id;mark();render();},'copy'),button('Delete',()=>{if(!value())return;draft.configurations=draft.configurations.filter(c=>c.id!==selected);if(draft.default===selected)delete draft.default;selected=draft.configurations[0]?.id;mark();render();},'trash'));list.append(bar);
      for(const language of [...new Set(draft.configurations.map(c=>c.language))]){list.append(el('div',languageName[language]||language,'group-title'));for(const c of draft.configurations.filter(c=>c.language===language)){const item=el('button',`${draft.default===c.id?'★ ':''}${c.name}`,`list-item${c.id===selected?' selected':''}`);item.title=c.name;item.onclick=()=>{if(flush()){selected=c.id;renderList();renderMain();}};list.append(item);}}
    }else if(mode==='toolchains'){
      const bar=el('div',undefined,'toolbar');bar.append(button('Locate',()=>{const c={id:uuid(),name:'Custom SDK',language:value()?.language||state.language,executable:'',version:'',manager:'custom',project:state.folder};tools.push(c);selectedTool=c.id;mark();render();},'add'),button('Remove',()=>{tools=tools.filter(t=>t.id!==selectedTool);selectedTool=tools[0]?.id;mark();render();},'trash'));list.append(bar);
      for(const t of tools){const item=el('button',t.name,`list-item${selectedTool===t.id?' selected':''}`);item.title=t.executable;item.onclick=()=>{selectedTool=t.id;render();};list.append(item);}
    }else{
      for(const [id,label]of [['installed','Installed SDKs'],['search','Available SDKs'],['updates','Updates'],['custom','Custom SDKs']]){const item=el('button',label,`list-item${sdkMode===id?' selected':''}`);item.onclick=()=>{sdkMode=id;sdkDetails=undefined;if(id==='custom'){mode='toolchains';render();return;}renderList();renderMain();if(id!=='search')sdkQuery();};list.append(item);}
      list.append(el('p','TypeScript / tsx are normally project dependencies. Virtual environments are not system SDK packages.','hint'));
    }
  }
  function renderMain(){
    const main=$('main');main.replaceChildren();
    if(mode==='sdk'){renderSdk(main);return;}
    if(mode==='toolchains'){renderTools(main);return;}
    const c=value();
    if(!c){const empty=el('div',undefined,'empty');empty.append(el('h2','Choose how your project runs'),el('p','Add a configuration to choose its entry, SDK, arguments and debug configuration. Existing launch.json and tasks.json remain unchanged.'),button('Add Configuration...',addConfiguration,'add',true));main.append(empty);return;}
    main.append(el('h2',c.name));
    const projects=state.projects.filter(p=>p.folder===state.folder);if(projects.length){const picker=el('select',undefined,'project-picker');picker.setAttribute('aria-label','Detected project');const root=el('option',`Project context: ${state.root}`);root.value=state.root;picker.append(root);for(const p of projects){if(p.root===state.root)continue;const o=el('option',`${p.marker} · ${p.root}`);o.value=p.root;picker.append(o);}picker.onchange=()=>{if(dirty){notice('Apply changes before switching project context.',true);picker.value=state.root;return;}send('project',{root:picker.value});};main.append(picker);}
    const form=el('div',undefined,'form');main.append(form);
    field(form,'name','Configuration name');field(form,'language','Language / Runtime',{options:languages.map(l=>[l,languageName[l]]),rerender:true});
    const kinds=['file','project','module','executable','task','launch'].filter(k=>!(['rust','csharp'].includes(c.language)&&['file','module'].includes(k))&&!(k==='module'&&!['python','java'].includes(c.language)));
    field(form,'kind','Configuration type',{options:kinds,rerender:true});field(form,'operation','Action',{options:['run','build','test'],rerender:true});
    const targetLabel=c.kind==='module'?'Module':c.kind==='launch'?'launch.json configuration name':c.kind==='task'?'tasks.json task label':c.kind==='project'&&['c','cpp'].includes(c.language)?'CMake build directory / Make project':'Target file / package / project';
    field(form,'target',targetLabel,{browse:!['module','task','launch'].includes(c.kind),directory:c.kind==='project',wide:true});if(['task','launch'].includes(c.kind)){form.append(el('p','This configuration delegates to the existing native task/launch entry. Its SDK, working directory, parameters and environment remain in tasks.json / launch.json; they are not overwritten.','hint'));field(form,'preLaunchTask','Additional pre-launch task label');if(c.kind==='task')field(form,'debugName','Corresponding launch.json Debug Configuration',{options:[['','Choose a Debug configuration'],...state.launch.map(l=>[l.name,l.name])],wide:true});form.append(button('Configure launch.json...',()=>send('nativeDebug'),'debug-alt'));const def=el('label',undefined,'check');const tick=el('input');tick.type='checkbox';tick.checked=draft.default===c.id;tick.onchange=()=>{if(tick.checked)draft.default=c.id;else delete draft.default;mark();renderList();};def.append(tick,document.createTextNode('Project default configuration'));form.append(def);return;}field(form,'cwd','Working directory',{browse:true,directory:true,wide:true});
    const label=c.language==='python'?'Interpreter / Virtual Environment':c.language==='rust'?'Cargo executable':c.language==='go'?'Go executable / SDK':c.language==='csharp'?'.NET SDK executable':['c','cpp'].includes(c.language)?'Compiler executable':['javascript','typescript','node'].includes(c.language)?'Node Runtime':'JDK executable';
    const input=field(form,'toolchain',label,{browse:true,wide:true,hint:'Empty inherits workspace → Sakura Atelier global default → automatic discovery. Project paths support ${workspaceFolder}; external SDK paths are saved locally.'});
    const choices=el('select');choices.setAttribute('aria-label','Choose discovered SDK');const none=el('option','Choose a discovered SDK...');none.value='';choices.append(none);for(const t of tools.filter(t=>t.language===c.language||t.language==='node'&&['typescript','javascript','node'].includes(c.language))){const o=el('option',`${t.name} · ${t.version} · ${t.manager}`);o.value=t.id;choices.append(o);}choices.onchange=()=>{if(!choices.value)return;c.toolchain='${toolchain:'+choices.value+'}';const sdk=tools.find(t=>t.id===choices.value);if(c.language==='rust'&&sdk?.rustToolchain)c.rustToolchain=sdk.rustToolchain;input.value=c.toolchain;mark();if(c.language==='python')send('pythonSelect',{id:choices.value});};form.append(choices,button(c.language==='python'?'Discover Python Environments':'Discover SDKs',()=>{notice('Discovering installed toolchains...');send('discover',{language:c.language});},'search'));
    if(c.language==='python'){
      const help=el('div',state.pythonStatus||`Official terminal activation: ${state.terminalActivation.modern}; legacy activateEnvironment: ${state.terminalActivation.legacy}`,'hint wide');form.append(help);check(form,'autoActivate','Activate environment in new Sakura Atelier terminals');form.append(button('Open Python Terminal',()=>{if(dirty){notice('Apply this configuration before opening its terminal.',true);return;}send('terminal');},'terminal'));
    }
    form.append(el('div','Language options','section-label'));
    if(['c','cpp'].includes(c.language)){field(form,'profile','Build profile',{options:['debug','release']});field(form,'standard',c.language==='c'?'C standard (e.g. c11)':'C++ standard (e.g. c++20)');if(c.kind!=='project'){field(form,'sources','Source files (JSON array)',{json:true,wide:true});field(form,'includePaths','Include paths (JSON array)',{json:true});field(form,'libraryPaths','Library paths (JSON array)',{json:true});field(form,'linkArgs','Linker arguments (JSON array)',{json:true,wide:true});}else{form.append(el('p','For CMake/Make projects, sources, include paths and libraries remain in the existing build files. CMake compiler changes require a separate build directory; Make controls its own build profile.','hint'));}field(form,'binary','CMake / Make target');}
    if(c.language==='go'){field(form,'goToolchain','GOTOOLCHAIN',{hint:'Defaults to local; no global Go environment is changed.'});field(form,'output','Build output',{browse:true});}
    if(c.language==='rust'){field(form,'rustToolchain','Installed rustup toolchain (stable / beta / nightly / custom)');field(form,'profile','Cargo profile',{options:['debug','release']});field(form,'package','Cargo package');field(form,'binary','Cargo binary');field(form,'example','Cargo example');field(form,'features','Features (JSON array)',{json:true});field(form,'cargoTarget','Cargo target triple');}
    if(['node','javascript','typescript','javascriptreact','typescriptreact'].includes(c.language)){field(form,'packageManager','Package manager',{options:['npm','pnpm','yarn']});field(form,'script','package.json script (optional)');if(c.language.startsWith('typescript')){field(form,'typescriptRunner','TypeScript execution',{options:['tsx','ts-node','tsc']});field(form,'output','Compiled JavaScript entry (tsc)',{browse:true});}}
    if(c.language==='csharp'){field(form,'profile','.NET configuration',{options:['debug','release']});field(form,'framework','Target framework');field(form,'launchProfile','launchSettings.json profile');form.append(el('p','For dotnet run select a startup .csproj; .sln/.slnx are valid build/test targets. SDK version policy within one dotnet installation follows the project global.json.','hint'));}
    if(c.language==='java'){field(form,'classPath','Classpath entries (JSON array)',{json:true});field(form,'modulePath','Module path entries (JSON array)',{json:true});}
    if(['c','cpp','rust'].includes(c.language))field(form,'output','Executable output (optional for single files)',{browse:true,wide:true,hint:'Empty single-file outputs use an extension-owned temporary directory. CMake/Make requires the actual output path.'});
    field(form,'buildArgs','Build / compiler arguments (JSON array)',{json:true,wide:true});field(form,'args','Program / test arguments (JSON array)',{json:true,wide:true});
    form.append(el('div','Environment and launch','section-label'));
    field(form,'env','Environment references (JSON object)',{json:true,wide:true,hint:'Use {"API_TOKEN":"${secret:API_TOKEN}"} or {"MODE":"${env:MODE}"}. Plaintext environment values are rejected.'});form.append(button('Store Secret...',()=>send('secret'),'key'));
    field(form,'preLaunchTask','Pre-launch build task label');field(form,'debugName','Existing launch.json Debug Configuration',{options:[['','Automatic compatible debugger'],...state.launch.map(l=>[l.name,l.name])],wide:true});field(form,'debugType','Debug adapter override (optional)',{hint:'Go / debugpy / lldb / cppdbg / cppvsdbg / pwa-node, when installed.'});
    check(form,'terminal','Run in an interactive terminal / use a debug terminal');
    const defaultCheck=el('label',undefined,'check');const defaultInput=el('input');defaultInput.type='checkbox';defaultInput.checked=draft.default===c.id;defaultInput.onchange=()=>{if(defaultInput.checked)draft.default=c.id;else delete draft.default;mark();renderList();};defaultCheck.append(defaultInput,document.createTextNode('Project default configuration'));form.append(defaultCheck);
    form.append(button('Configure launch.json...',()=>send('nativeDebug'),'debug-alt'));
  }
  function renderTools(main){
    main.append(el('h2','Toolchains'),el('p','Discover existing SDKs or locate an executable. Machine-specific SDK paths stay in local VS Code state; project files refer to an SDK ID. No global PATH or shell initialization files are changed.'));
    const lang=el('select');for(const l of languages){const o=el('option',languageName[l]);o.value=l;lang.append(o);}lang.value=tools.find(t=>t.id===selectedTool)?.language||value()?.language||state.language;
    const row=el('div',undefined,'row');row.append(lang,button('Discover',()=>{notice('Discovering...');send('discover',{language:lang.value});},'search'),button('SDK Manager',()=>{mode='sdk';render();},'package'));main.append(row);
    const tool=tools.find(t=>t.id===selectedTool);if(!tool){main.append(el('p','No SDK selected. Discover installed SDKs or click Locate to add a custom executable.','hint'));return;}
    const form=el('div',undefined,'form');main.append(form);field(form,'name','SDK name',{object:tool});field(form,'language','Language',{object:tool,options:languages.map(l=>[l,languageName[l]])});field(form,'executable','Executable path',{object:tool,browse:true,wide:true});field(form,'version','Installed version',{object:tool});field(form,'manager','Environment / version manager',{object:tool});field(form,'details','SDK details (GOROOT / installed SDKs / rustup toolchains)',{object:tool,multiline:true,wide:true,readonly:true});
    const buttons=el('div',undefined,'buttons');buttons.append(button('Set Workspace Default',()=>send('defaultSdk',{id:tool.id,global:false}),'check'),button('Set Atelier Global Default',()=>send('defaultSdk',{id:tool.id,global:true})),button('Locate Existing SDK',()=>send('browse',{field:'tcPath'}),'folder-opened'));main.append(buttons);
    if(tool.language==='python')main.append(button('Create Virtual Environment...',()=>send('createVenv',{id:tool.id}),'add'));
  }
  function sdkQuery(){notice('Querying package manager...');send('sdkList',{mode:sdkMode,keyword:$('sdkSearch')?.value||'go'});}
  function renderSdk(main){
    main.append(el('h2','SDK Manager'),el('p',state.sdkStatus),el('p','System SDKs are installed only after a native confirmation showing the exact version, source and command. Project dependencies such as TypeScript/tsx should normally be installed through the project package manager.'));
    const row=el('div',undefined,'row');const search=el('input');search.id='sdkSearch';search.placeholder='Search Go, Rust, Python, Node, Clang, .NET...';search.value=vscode.getState()?.sdkSearch||'go';search.oninput=()=>vscode.setState({...(vscode.getState()||{}),sdkSearch:search.value});search.onkeydown=e=>{if(e.key==='Enter'){sdkMode='search';sdkQuery();}};row.append(search,button('Search',()=>{sdkMode='search';renderList();sdkQuery();},'search'),button('Refresh',sdkQuery,'refresh'));main.append(row);
    const actions=el('div',undefined,'buttons');actions.append(button('Package Manager Instructions',()=>send('sdkHelp'),'link-external'),button('Locate Existing SDK',()=>{mode='toolchains';render();},'folder-opened'),button('Refresh Toolchains',()=>{notice('Refreshing SDKs...');send('refreshTools');},'refresh'));main.append(actions);
    const table=el('table',undefined,'sdk-table');const head=el('tr');for(const name of ['SDK / Package','Version','Installed','Source','Kind'])head.append(el('th',name));table.append(head);for(const item of sdkPackages){const row=el('tr');for(const text of [item.name,item.version||'Query details',item.installedVersion||'—',item.source,item.kind])row.append(el('td',text));row.onclick=()=>{notice('Querying exact package details...');send('sdkDetails',{item});};table.append(row);}main.append(table);
    if(!sdkPackages.length)main.append(el('p','Search a package or choose Installed SDKs / Updates. Empty results and missing package managers are reported without installing anything.','hint'));
    if(sdkDetails){const d=sdkDetails;const details=el('section',undefined,'details');details.append(el('h2',d.name),el('p',`ID: ${d.id}\nSource: ${d.source}\nType: ${d.kind} · ${d.scope||'system'}\nLanguage: ${d.language||'Unclassified'}\nInstallation path: ${d.installedPath||'Locate the executable in Toolchains'}\nInstalled: ${d.installedVersion||'not installed'}`),el('p',d.description||''),el('p',d.details||''));const version=el('select');version.setAttribute('aria-label','SDK version');for(const v of d.versions){const o=el('option',v);o.value=v;version.append(o);}details.append(version,button('Install',()=>send('sdkInstall',{key:`${d.kind}:${d.source}:${d.id}`,version:version.value}),'cloud-download',true),el('p','Installation may prompt for administrator permission or licenses in the terminal. Sakura Atelier does not read passwords or accept licenses for you.','hint'));main.append(details);}
  }
  function save(close){if(!flush())return;send('save',{document:draft,revision:state.revision,toolchains:tools,selected,close});notice('Saving...');}
  window.addEventListener('message',event=>{
    const message=event.data;if(!message||typeof message!=='object')return;
    if(message.type==='state'){state=message;draft=JSON.parse(JSON.stringify(state.document));tools=JSON.parse(JSON.stringify(state.toolchains));selected=draft.configurations.some(c=>c.id===selected)?selected:draft.default||draft.configurations[0]?.id;selectedTool=tools.some(t=>t.id===selectedTool)?selectedTool:tools[0]?.id;if(message.mode)mode=message.mode;dirty=false;render();notice('Ready');if(message.add)addConfiguration();}
    else if(message.type==='mode'){if(!flush())return;mode=message.mode;state.file=message.file;state.language=message.language;if(message.sdkStatus)state.sdkStatus=message.sdkStatus;render();if(message.add)addConfiguration();}
    else if(message.type==='toolsRefreshed'){const map=new Map([...tools,...message.tools].map(t=>[t.id,t]));tools=[...map.values()];state.sdkStatus=message.sdkStatus;render();notice('Installed toolchains refreshed. Unsaved configuration edits were preserved.');}
    else if(message.type==='saved'){state.document=message.document;state.revision=message.revision;draft=JSON.parse(JSON.stringify(message.document));dirty=false;render();notice('Applied. Selected configuration is ready for Run / Debug.');}
    else if(message.type==='error'){notice(message.message,true);}
    else if(message.type==='notice'){notice(message.message);}
    else if(message.type==='browsed'){if(message.field==='tcPath'){const t=tools.find(t=>t.id===selectedTool);if(t)t.executable=message.path;}else{const c=value();if(c)c[message.field]=message.path;}mark();renderMain();}
    else if(message.type==='discovered'){const map=new Map([...tools,...message.tools].map(t=>[t.id,t]));tools=[...map.values()];selectedTool=message.tools[0]?.id||selectedTool;mark();render();notice(`${message.tools.length} installed SDK(s) found. Apply to retain this local SDK list.`);}
    else if(message.type==='pythonStatus'){state.pythonStatus=message.message;notice(message.message);}
    else if(message.type==='sdkPackages'){sdkPackages=message.packages;sdkDetails=undefined;renderMain();notice(`${sdkPackages.length} package(s) returned by the package manager.`);}
    else if(message.type==='sdkDetails'){sdkDetails=message.details;renderMain();notice('Verified package details. Install requires a separate native confirmation.');}
  });
  shell();send('ready');
})();
