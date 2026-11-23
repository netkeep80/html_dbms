'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs');
const read=fs.readFileSync(require('node:path').join(__dirname,'../docs/SRS-3.md'),'utf8');
assert.match(read,/HTML_DBMS\/4/);assert.match(read,/\[timestamp, previousHEAD, operations\]/);assert.match(read,/seq.*не хранится/);
console.log('HTML_DBMS/4 specification checks PASS');
