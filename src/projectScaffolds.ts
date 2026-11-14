import type { RuntimeLanguage } from './configuration';
import { validateFile } from './configuration';
import { createTemplateDraft } from './templates';

export type ProjectLanguage = 'go' | 'python' | 'rust' | 'node' | 'typescript' | 'c' | 'cpp' | 'csharp' | 'java';
export interface ScaffoldFile { path: string; content: string }
export const projectLanguages: readonly { language: ProjectLanguage; label: string; sdk: string; template: string; entry: string; marker: string }[] = [
  { language: 'python', label: 'Python project', sdk: 'Python', template: 'python.script', entry: 'src/main.py', marker: 'pyproject.toml' },
  { language: 'node', label: 'JavaScript / Node.js project', sdk: 'Node.js', template: 'node.application', entry: 'src/main.js', marker: 'package.json' },
  { language: 'typescript', label: 'TypeScript project', sdk: 'Node.js', template: 'typescript.file', entry: 'src/main.ts', marker: 'package.json' },
  { language: 'go', label: 'Go project', sdk: 'Go', template: 'go.application', entry: 'main.go', marker: 'go.mod' },
  { language: 'rust', label: 'Rust / Cargo project', sdk: 'Rust / Cargo', template: 'cargo.run', entry: 'src/main.rs', marker: 'Cargo.toml' },
  { language: 'c', label: 'C project', sdk: 'C compiler', template: 'c.file', entry: 'src/main.c', marker: 'CMakeLists.txt' },
  { language: 'cpp', label: 'C++ project', sdk: 'C++ compiler', template: 'cpp.file', entry: 'src/main.cpp', marker: 'CMakeLists.txt' },
  { language: 'csharp', label: 'C# / .NET project', sdk: '.NET SDK', template: 'dotnet.application', entry: 'App.csproj', marker: 'App.csproj' },
  { language: 'java', label: 'Java project', sdk: 'JDK 11+', template: 'java.application', entry: 'Main.java', marker: 'Main.java' },
];
const json = (value: unknown) => JSON.stringify(value, null, 2) + '\n';

/** Static project files, with the existing run-template factory and configuration schema. No SDK or dependency installation. */
export function projectScaffold(language: ProjectLanguage, name: string): ScaffoldFile[] {
  const spec = projectLanguages.find(p => p.language === language);
  if (!spec) throw new Error('Unsupported project language.');
  const slug = name.toLowerCase().replace(/_/g, '-');
  const cargoName = slug.replace(/[^a-z0-9_-]/g, '-');
  const crate = /^[a-z]/.test(cargoName) ? cargoName : 'app-' + cargoName;
  const sources: Record<ProjectLanguage, ScaffoldFile[]> = {
    python: [
      { path: 'src/main.py', content: 'def main():\n    print("Hello from Sakura Atelier")\n\n\nif __name__ == "__main__":\n    main()\n' },
      { path: 'pyproject.toml', content: `[project]\nname = ${JSON.stringify(slug)}\nversion = "0.1.0"\nrequires-python = ">=3.9"\n` },
    ],
    node: [
      { path: 'src/main.js', content: 'console.log("Hello from Sakura Atelier");\n' },
      { path: 'package.json', content: json({ name: slug, version: '0.1.0', private: true, type: 'module', scripts: { start: 'node src/main.js' } }) },
    ],
    typescript: [
      { path: 'src/main.ts', content: 'const message: string = "Hello from Sakura Atelier";\nconsole.log(message);\n' },
      { path: 'package.json', content: json({ name: slug, version: '0.1.0', private: true, type: 'module', scripts: { start: 'tsx src/main.ts', build: 'tsc -p .' }, devDependencies: { tsx: '^4.23.15', typescript: '^5.7.0' } }) },
      { path: 'tsconfig.json', content: json({ compilerOptions: { target: 'ES2022', module: 'NodeNext', moduleResolution: 'NodeNext', strict: true, outDir: 'dist' }, include: ['src/**/*.ts'] }) },
    ],
    go: [
      { path: 'main.go', content: 'package main\n\nimport "fmt"\n\nfunc main() {\n\tfmt.Println("Hello from Sakura Atelier")\n}\n' },
      { path: 'go.mod', content: `module example.com/${slug}\n\ngo 1.22\n` },
    ],
    rust: [
      { path: 'src/main.rs', content: 'fn main() {\n    println!("Hello from Sakura Atelier");\n}\n' },
      { path: 'Cargo.toml', content: `[package]\nname = ${JSON.stringify(crate)}\nversion = "0.1.0"\nedition = "2021"\n` },
    ],
    c: [
      { path: 'src/main.c', content: '#include <stdio.h>\n\nint main(void) {\n    puts("Hello from Sakura Atelier");\n    return 0;\n}\n' },
      { path: 'CMakeLists.txt', content: 'cmake_minimum_required(VERSION 3.16)\nproject(SakuraProject LANGUAGES C)\nset(CMAKE_C_STANDARD 11)\nadd_executable(app src/main.c)\n' },
    ],
    cpp: [
      { path: 'src/main.cpp', content: '#include <iostream>\n\nint main() {\n    std::cout << "Hello from Sakura Atelier" << std::endl;\n}\n' },
      { path: 'CMakeLists.txt', content: 'cmake_minimum_required(VERSION 3.16)\nproject(SakuraProject LANGUAGES CXX)\nset(CMAKE_CXX_STANDARD 17)\nadd_executable(app src/main.cpp)\n' },
    ],
    csharp: [
      { path: 'Program.cs', content: 'Console.WriteLine("Hello from Sakura Atelier");\n' },
      { path: 'App.csproj', content: '<Project Sdk="Microsoft.NET.Sdk">\n  <PropertyGroup>\n    <OutputType>Exe</OutputType>\n    <TargetFramework>net8.0</TargetFramework>\n    <ImplicitUsings>enable</ImplicitUsings>\n    <Nullable>enable</Nullable>\n  </PropertyGroup>\n</Project>\n' },
    ],
    java: [{ path: 'Main.java', content: 'class Main {\n    public static void main(String[] args) {\n        System.out.println("Hello from Sakura Atelier");\n    }\n}\n' }],
  };
  const portable = '${workspaceFolder}';
  const config = createTemplateDraft(spec.template, { id: 'new-project', folder: portable, root: portable, label: name, cwd: portable, languages: [language], entries: { [language]: portable + '/' + spec.entry }, markers: [spec.marker], scripts: [], tasks: [], examples: [] }, 'run');
  config.name = name + ' · Run';
  if (language === 'typescript') config.typescriptRunner = 'tsx';
  if (language === 'c') config.standard = 'c11';
  if (language === 'cpp') config.standard = 'c++17';
  const document = validateFile({ version: 1, default: config.id, configurations: [config] });
  return [...sources[language],
    { path: '.gitignore', content: '.DS_Store\nnode_modules/\ndist/\nbuild/\ntarget/\nbin/\nobj/\n.venv/\n__pycache__/\n*.class\n' },
    { path: 'README.md', content: `# ${name}\n\nCreated with Sakura Atelier.\n\nRequired SDK: ${spec.sdk}${language === 'csharp' ? ' 8.0 or compatible' : ''}.\nOpen this folder in VS Code and use Sakura Atelier Run / Debug.\nThe run configuration uses the existing Sakura Atelier schema and keeps SDK paths machine-local.\n${language === 'typescript' ? '\nInstall the declared project dependencies with your package manager before Run, or use Sakura Atelier project dependency inspection and review its confirmation.\n' : ''}` },
    { path: '.vscode/sakura-atelier.json', content: json(document) },
  ];
}

export const runtimeForProject = (language: ProjectLanguage): RuntimeLanguage => language === 'typescript' ? 'node' : language;
