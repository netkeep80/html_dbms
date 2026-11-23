'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs');
const read=fs.readFileSync(require('node:path').join(__dirname,'../docs/SRS-3.md'),'utf8');
assert.match(read,/HTML_DBMS\/3/);assert.match(read,/\[timestamp, prevID, prevH, operations\]/);assert.match(read,/seq.*не хранится/);
console.log('HTML_DBMS/3 specification checks PASS');
