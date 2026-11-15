import type {RuntimeLanguage} from '../configuration';
export interface LanguageProjectOptions {
  sdkId?:string; pythonManager?:'pip'|'uv'; nodeManager?:'npm'|'pnpm';
  javaFramework?:'application'|'spring-boot'; javaBuild?:'maven'|'gradle-groovy'|'gradle-kotlin';
  javaVersion?:string; groupId?:string; artifactId?:string; packageName?:string; projectVersion?:string;
  description?:string; frameworkVersion?:string; dependencies?:string;
}
export interface ProjectSdk {id:string;name:string;language:RuntimeLanguage;executable:string;version:string}
export function languageOption(key:string,value:unknown):boolean {
  if(typeof value!=='string'||/[\0\r\n]/.test(value))return false;
  const choices:Record<string,string[]>={pythonManager:['pip','uv'],nodeManager:['npm','pnpm'],javaFramework:['application','spring-boot'],javaBuild:['maven','gradle-groovy','gradle-kotlin']};
  if(choices[key])return choices[key].includes(value);
  if(key==='sdkId')return /^[\w.:-]{1,200}$/.test(value);
  if(key==='javaVersion')return /^\d{0,2}$/.test(value);
  if(['groupId','packageName'].includes(key))return value.length<=200 && /^[a-zA-Z0-9_.]*$/.test(value);
  if(['artifactId','projectVersion','frameworkVersion'].includes(key))return value.length<=100 && /^[a-zA-Z0-9_.-]*$/.test(value);
  if(key==='dependencies')return value.length<=2000 && /^(?:[\w-]+(?:,[\w-]+)*)?$/.test(value);
  return key==='description' && value.length<=500;
}

export function javaOptionError(options:LanguageProjectOptions):string|undefined {
  if(options.javaVersion && (!/^\d+$/.test(options.javaVersion)||Number(options.javaVersion)<8))return 'Java 版本必须是 8 或更高的整数。';
  for(const key of ['groupId','packageName'] as const)if(options[key] && !/^[a-zA-Z_]\w*(?:\.[a-zA-Z_]\w*)*$/.test(options[key]!))return `${key} 必须是有效的点分 Java 标识符。`;
  for(const key of ['artifactId','projectVersion'] as const)if(options[key] && !/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(options[key]!))return `${key} 必须以字母或数字开头。`;
  return undefined;
}
