const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {planCreation,executeCreation}=require('../out/src/embedded/projects/creation');
const {builtinProjectTemplates}=require('../out/src/embedded/projects/template');
const {initializeLanguageProject}=require('../out/src/languageProjects/initialize');
const {installJavaTool}=require('../out/src/languageProjects/javaTools');
const {initializationRunner}=require('../out/src/languageProjects/process');
const {initializrMetadata}=require('../out/src/languageProjects/springInitializr');
const {validateFile}=require('../out/src/configuration');
const assert=require('node:assert/strict');
(async()=>{
  const sandbox=await fs.mkdtemp(path.join(os.tmpdir(),'sakura 语言初始化 空格 '));
  const results=[];const abort=new AbortController();
  const run=initializationRunner(()=>{},abort.signal,message=>console.log(message));
  const node=process.execPath,python=process.env.SAKURA_TEST_PYTHON || '/usr/bin/python3',uv=process.env.SAKURA_TEST_UV || '/opt/homebrew/bin/uv';
  const tools={runtimes:{node,python},uv};
  const create=async(language,name,options={})=>{
    const plan=await planCreation({templateId:'general.'+language,parentDir:sandbox,name,options},{template:builtinProjectTemplates.find(t=>t.id==='general.'+language),tools,boards:new Map(),fs:{exists:file=>fs.lstat(file).then(()=>true,()=>false),isDirectory:file=>fs.stat(file).then(s=>s.isDirectory(),()=>false)},isStm32Project:async()=>false});
    assert.deepEqual(plan.blockers,[]);
    await executeCreation(plan,{mkdir:file=>fs.mkdir(file),writeFile:(file,content)=>fs.writeFile(file,content,{flag:'wx'}),run,initializeProject:input=>initializeLanguageProject(input,run,message=>console.log(message),abort.signal)});
    const saved=validateFile(JSON.parse(await fs.readFile(path.join(plan.target,'.vscode/sakura-atelier.json'),'utf8')));
    assert.equal(saved.default,'run');assert.ok(!JSON.stringify(saved).includes(sandbox));
    results.push({language,name,status:'passed'});console.log('PASS',name);return {root:plan.target,saved};
  };
  try{
    if(process.env.SAKURA_ONLY_JAVA!=='1'){
      const pip=await create('python','python-pip');assert.ok(await fs.stat(path.join(pip.root,'.venv/pyvenv.cfg')));
      await create('python','python-uv',{pythonManager:'uv'});
      for(const manager of ['npm','pnpm']){
        tools.pnpm='/opt/homebrew/bin/pnpm';const project=await create('typescript','typescript-'+manager,{nodeManager:manager});
        const {nodeManagerStep}=require('../out/src/languageProjects/nodeManager');
        const build=await nodeManagerStep(node,manager,['run','build'],project.root);await run(build.command,build.args,build.cwd,build.env);
        assert.match(await run(node,['dist/index.js'],project.root),/Hello from Sakura Atelier/);
        console.log('PASS TypeScript build + compiled JS',manager);
      }
    }
    if(process.env.SAKURA_TEST_JAVA){
      tools.runtimes.java=process.env.SAKURA_TEST_JAVA;
      const storage=path.resolve(__dirname,'../.test-output/java-tools');
      tools.maven=await installJavaTool(storage,'maven',console.log,abort.signal);
      tools.gradle=await installJavaTool(storage,'gradle',message=>{if(!message.includes(' MB'))console.log(message);},abort.signal);
      for(const javaBuild of ['maven','gradle-groovy','gradle-kotlin'])await create('java','java-'+javaBuild,{javaBuild,javaVersion:'17',groupId:'com.example',artifactId:'app',packageName:'com.example.app'});
      const metadata=await initializrMetadata();const boot=metadata.bootVersions.find(v=>!/(SNAPSHOT|M\d|RC\d)/.test(v.id)).id;
      for(const build of (process.env.SAKURA_SPRING_GRADLE==='1'?['maven','gradle-groovy','gradle-kotlin']:['maven']))await create('java','spring-'+build,{javaFramework:'spring-boot',javaBuild:build,javaVersion:'17',frameworkVersion:boot,dependencies:'web',artifactId:'spring-'+build,packageName:'com.example.app'});
    }else console.log('SKIP real Java: set SAKURA_TEST_JAVA to a working JDK java executable');
  }finally{
    await fs.mkdir(path.resolve(__dirname,'../.test-output'),{recursive:true});
    await fs.writeFile(path.resolve(__dirname,'../.test-output/language-projects-integration.json'),JSON.stringify({platform:process.platform,arch:process.arch,results},null,2));
    if(process.env.SAKURA_KEEP_FIXTURES==='1')console.log('Fixtures:',sandbox);else await fs.rm(sandbox,{recursive:true,force:true});
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
