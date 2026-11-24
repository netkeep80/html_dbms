"""External V8 range accounting. Offsets are UTF-16 code units, not bytes.
Report observed functions and effective source spans; not an AST branch metric.
"""
import bisect
import hashlib
import json
import sys
from pathlib import Path
from urllib.parse import urlparse, unquote

class Coverage:
    def __init__(self, name, source):
        self.name=name
        self.source=source
        self.utf16=source.encode('utf-16-le',errors='surrogatepass')
        self.covered=bytearray(len(self.utf16)//2)
        self.functions={}
        self.samples=0

    def fragment(self,start,end):
        return self.utf16[start*2:end*2].decode('utf-16-le',errors='replace')

    def add(self,functions):
        self.samples+=1
        # Outer function ranges are overridden by nested functions and blocks.
        # Then take the union of executed offsets across all script instances.
        mask=bytearray(len(self.covered))
        spans=[]
        for f in functions:
            ranges=f['ranges']
            if not ranges:continue
            root=ranges[0]
            key=(root['startOffset'],root['endOffset'],f['functionName'])
            self.functions[key]=self.functions.get(key,False) or root['count']>0
            for item in ranges:
                start,end,count=(item[k] for k in ('startOffset','endOffset','count'))
                assert 0<=start<=end<=len(mask),(self.name,start,end,len(mask))
                spans.append((start,end,count))
        for start,end,count in sorted(spans,key=lambda v:(v[0]-v[1],v[0])):
            mask[start:end]=bytes([int(count>0)])*(end-start)
        self.covered=bytearray(a|b for a,b in zip(self.covered,mask))

    def report(self):
        assert self.samples and self.functions,self.name+' not observed by V8'
        assert any(self.covered),self.name+' not executed'
        def line(offset):
            return self.utf16[:offset*2].count(b'\n\x00')+1
        def describe(start,end):
            return {'start':start,'end':end,'line':line(start),'text':self.fragment(start,min(end,start+110))}
        missed=[]
        i=0
        while i<len(self.covered):
            if self.covered[i]:i+=1;continue
            j=i+1
            while j<len(self.covered) and not self.covered[j]:j+=1
            if self.fragment(i,j).strip():missed.append(describe(i,j))
            i=j
        functions=[{**describe(start,end),'name':name,'hit':hit} for (start,end,name),hit in sorted(self.functions.items())]
        result={'component':self.name,'sha256':hashlib.sha256(self.source.encode('utf8')).hexdigest(),
                'samples':self.samples,'coveredUtf16':sum(self.covered),'totalUtf16':len(self.covered),
                'observedFunctionsHit':sum(self.functions.values()),'observedFunctions':len(self.functions),
                'uncoveredSpans':missed,'functions':functions}
        print('V8 COVERAGE',json.dumps({k:v for k,v in result.items() if k not in ('uncoveredSpans','functions')},ensure_ascii=False),flush=True)
        print('V8 UNCOVERED',self.name,json.dumps(missed,ensure_ascii=False),flush=True)
        print('V8 FUNCTIONS',self.name,json.dumps([{k:v for k,v in f.items() if k!='text'} for f in functions],ensure_ascii=False),flush=True)
        return result

def core_report(directory):
    root=Path(__file__).resolve().parents[1]
    source=root/'src/core.js'
    report=Coverage('src/core.js',source.read_text('utf8'))
    for path in sorted(Path(directory).glob('coverage-*.json')):
        for script in json.loads(path.read_text('utf8'))['result']:
            url=urlparse(script['url'])
            if url.scheme=='file' and Path(unquote(url.path)).resolve()==source:
                report.add(script['functions'])
    result=report.report()
    (Path(directory)/'core-ranges.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf8')

if __name__=='__main__':
    core_report(sys.argv[1])
