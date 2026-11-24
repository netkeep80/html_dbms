'use strict';
// External Node adapter: intentionally excluded from the browser build.
if(!globalThis.crypto)Object.defineProperty(globalThis,'crypto',{value:require('node:crypto').webcrypto,configurable:true});
module.exports=require('./core.js');
