const esbuild=require('esbuild');
esbuild.buildSync({entryPoints:['src/launchConfigurations.ts'],outfile:'out/src/launchConfigurations.js',bundle:true,mainFields:['module','main'],platform:'node',target:'node18',format:'cjs',external:['vscode','./detect','./model'],legalComments:'inline'});
