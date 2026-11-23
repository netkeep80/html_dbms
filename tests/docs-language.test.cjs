'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs');
const s=fs.readFileSync(require('node:path').join(__dirname,'../docs/SRS-3.md'),'utf8');
assert.match(s,/HTML_DBMS\/3/);assert.match(s,/\\[timestampISOUTC,prevID,prevH,patchArray\\]/);
assert.match(s,/подставляет/);assert.match(s,/entry/);
console.log('HTML_DBMS/3 specification tests PASS');
