#!/usr/bin/env python3
from __future__ import annotations
import importlib.util, json, re
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
ROOT=Path('.')
spec=importlib.util.spec_from_file_location('tr', ROOT/'tools/translate-ui-strings.py')
tr=importlib.util.module_from_spec(spec); spec.loader.exec_module(tr)
KEY='Prepare local engine'
OBSOLETE=['Request local model permission','Local model permission granted.','Local model permission was declined or this browser does not expose trialML.']
def translate(locale, language):
    for attempt in range(1,4):
        try:
            values,_=tr.request(locale,language,[KEY],600,300,1024); return locale,values[0]
        except Exception:
            if attempt==3: return locale,tr.request_single(locale,language,KEY,300,1024)
def apply(locale,value):
    path=ROOT/'src/shared/locales'/f'{locale}.js'; source=path.read_text(encoding='utf-8')
    for key in OBSOLETE: source=re.sub(r"^\s*(['\"])"+re.escape(key)+r"\1\s*:\s*.*?,?\s*$",'',source,flags=re.M)
    entry=f'  {json.dumps(KEY,ensure_ascii=False)}: {json.dumps(value,ensure_ascii=False)}'
    path.write_text(source.replace('\n});',',\n'+entry+'\n});',1),encoding='utf-8')
results={}
with ThreadPoolExecutor(max_workers=3) as executor:
    futures={executor.submit(translate,locale,language):locale for locale,language in tr.LANGUAGES.items()}
    for future in as_completed(futures):
        locale,value=future.result(); results[locale]=value; print(locale,value,flush=True)
out=ROOT/'tools/ui-translation-results-local-engine.json'; out.write_text(json.dumps({'key':KEY,'locales':results},ensure_ascii=False,indent=2),encoding='utf-8')
for locale,value in results.items(): apply(locale,value)
print('updated',len(results),'locales')
