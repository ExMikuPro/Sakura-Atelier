const esbuild=require('esbuild');
esbuild.buildSync({entryPoints:['src/launchConfigurations.ts'],outfile:'out/src/launchConfigurations.js',bundle:true,mainFields:['module','main'],platform:'node',target:'node18',format:'cjs',external:['vscode','./detect','./model'],legalComments:'inline'});
esbuild.buildSync({entryPoints:['src/localization.ts'],outfile:'media/localization.js',bundle:true,platform:'browser',target:'es2022',format:'iife',globalName:'AtelierI18n',legalComments:'none'});
