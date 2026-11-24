'use strict';
// Build-only, pinned syntax-aware compilers. Never included in the artifact.
const fs=require('node:fs'),path=require('node:path'),esbuild=require('esbuild'),{minify}=require('html-minifier-terser');
const root=path.resolve(__dirname,'..'),read=name=>fs.readFileSync(path.join(root,'src',name),'utf8');
const opts={minify:true,legalComments:'none',charset:'utf8',target:'es2022'};
function replace(source,marker,value){if(source.split(marker).length!==2)throw Error('Expected one marker: '+marker);return source.replace(marker,()=>value);}
const js=(code,format='iife')=>esbuild.transformSync(code,{...opts,loader:'js',format}).code.trim();
const css=code=>esbuild.transformSync(code,{...opts,loader:'css'}).code.trim();
const markup=async source=>(await minify(source,{collapseWhitespace:true,removeComments:true,removeOptionalTags:false,removeAttributeQuotes:false,removeRedundantAttributes:false,caseSensitive:true,minifyJS:false,minifyCSS:false,useShortDoctype:true})).replace(/^<!doctype html>/i,'<!doctype html>');
(async()=>{
 const sandbox=replace(await markup(read('sandbox.html')),'/* SANDBOX_JS */',js(read('sandbox.js')));
 const app=js(replace(read('app.js'),"'/* SANDBOX_DOCUMENT */'",JSON.stringify(sandbox)));
 const starter=js(replace(read('starter.js'),"'/* STARTER_CSS */'",JSON.stringify(css(read('starter.css')))),'esm');
 const core=esbuild.buildSync({...opts,entryPoints:[path.join(root,'src/browser-core.js')],bundle:true,write:false,format:'iife',platform:'browser'}).outputFiles[0].text.trim();
 const source=read('index.html'),template=await markup(source.replace(/<style>([\s\S]*?)<\/style>/,(_,s)=>'<style>'+css(s)+'</style>'));
 process.stdout.write(JSON.stringify({template,'app.js':app,'starter.js':starter,'core.js':core}));
})().catch(e=>{console.error(e.message);process.exitCode=1;});
