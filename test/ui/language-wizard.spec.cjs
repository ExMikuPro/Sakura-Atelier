const {test,expect}=require('@playwright/test');
const {WizardModel,parseMessage}=require('../../out/src/embedded/projects/wizardModel');
const {renderWizardHtml}=require('../../out/src/embedded/projects/wizardHtml');
const {builtinProjectTemplates}=require('../../out/src/embedded/projects/template');
const {DeviceFavorites}=require('../../out/src/embedded/devices/favorites');
const {RecentDevices}=require('../../out/src/embedded/devices/recents');
const {FavoriteTemplates}=require('../../out/src/embedded/projects/favoriteTemplates');
async function open(page,template){
  const data=new Map(),store={get:(key,fallback)=>data.get(key)??fallback,update:async(key,value)=>data.set(key,value)};
  const model=new WizardModel({favorites:new DeviceFavorites(store),recents:new RecentDevices(store),templates:new FavoriteTemplates(store),projectTemplates:{get:id=>builtinProjectTemplates.find(t=>t.id===id),values:()=>builtinProjectTemplates},snapshot:()=>({devices:[],status:new Map()}),loaded:()=>true,creation:()=>({tools:{runtimes:{python:'/python',node:'/node',java:'/java'},uv:'/uv',pnpm:'/pnpm'},sdkChoices:[{id:'jdk17',name:'JDK',language:'java',executable:'/jdk17',version:'17'}],fs:{exists:async()=>false,isDirectory:async()=>true},isStm32Project:async()=>false}),language:'zh-cn'},{templateId:template,parentDir:'/projects',name:'demo'});
  await page.exposeFunction('hostMessage',async raw=>{const m=parseMessage(raw);if(!m)return;if(m.type==='option')model.setOption(m.key,m.value);if(m.type==='name')model.setName(m.value);if(m.type==='selectTemplate')model.selectTemplate(m.id);return {type:'view',clientRevision:raw.clientRevision,view:await model.view()};});
  await page.addInitScript(()=>{window.acquireVsCodeApi=()=>({postMessage:async message=>{window.__lastMessage=message;const reply=await window.hostMessage(message);if(reply)window.postMessage(reply,'*');}});});
  await page.goto('data:text/html,'+encodeURIComponent(renderWizardHtml({nonce:'test',cspSource:'data:',codiconUri:'data:text/css,',cssLanguage:'zh-CN',title:'Wizard'})));
  return model;
}
test('Python and TypeScript reuse the wizard SDK/manager controls and preserve Chinese input',async({page})=>{
  await open(page,'general.python');await expect(page.getByLabel('依赖管理')).toBeVisible();await page.getByLabel('依赖管理').selectOption('uv');
  await page.locator('#nav button').filter({hasText:'TypeScript 项目'}).click();await expect(page.getByLabel('包管理器')).toBeVisible();await page.getByLabel('包管理器').selectOption('pnpm');
  await expect(page.getByText('src/index.ts',{exact:true})).toBeVisible();await expect(page.getByText('pnpm-workspace.yaml',{exact:true})).toBeVisible();await expect(page.locator('#create')).toBeEnabled();
});
test('Java adds shared options without changing embedded wizard controls; coordinates can be typed incrementally',async({page})=>{
  await open(page,'general.java');await expect(page.getByLabel('项目类型')).toBeVisible();await page.getByLabel('构建工具').selectOption('gradle-kotlin');
  await page.getByLabel('Group ID').fill('org.acme');await expect(page.getByLabel('Group ID')).toHaveValue('org.acme');
  await page.getByLabel('Package Name').fill('org.acme.app');await expect(page.getByLabel('Package Name')).toHaveValue('org.acme.app');
  await expect(page.getByText('一键配置 Maven / Gradle / Wrapper',{exact:true})).toBeVisible();
  await page.locator('#nav button').filter({hasText:'PlatformIO'}).first().click();await expect(page.getByLabel('Group ID')).toHaveCount(0);await expect(page.locator('#sample')).toBeVisible();
});
