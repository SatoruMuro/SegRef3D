// Headless browser -> downloaded request -> pinned Python CPU backend.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { fixture } from './fixtures.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url));
const output=path.resolve(process.argv[2] || 'build/evalref3d-browser');
await mkdir(output,{recursive:true});
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const mime={'.html':'text/html','.mjs':'text/javascript','.js':'text/javascript','.css':'text/css','.json':'application/json'};
const server=createServer(async(req,res)=>{
  try {
    const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
    const filename=path.resolve(root,`.${pathname.endsWith('/') ? pathname+'index.html' : pathname}`);
    const relative=path.relative(root,filename);
    if(relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Outside test root');
    res.writeHead(200,{'Content-Type':mime[path.extname(filename)] || 'application/octet-stream'});res.end(await readFile(filename));
  } catch {res.writeHead(404);res.end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin=`http://127.0.0.1:${server.address().port}`;
let browser;
try {
  browser=await chromium.launch({headless:true,...(process.env.BROWSER_CHANNEL ? {channel:process.env.BROWSER_CHANNEL} : {})});
  const context=await browser.newContext({acceptDownloads:true,viewport:{width:1200,height:1000}});
  const errors=[],external=[];
  await context.route('**/*',route=>{
    const url=route.request().url();
    if(!url.startsWith(origin)) {external.push(url); return route.abort();}
    return route.continue();
  });
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  page.on('console',m=>{if(m.type()==='error') errors.push(m.text());});
  page.on('requestfailed',r=>errors.push(`${r.url()}: ${r.failure()?.errorText}`));
  const f=await fixture();
  async function save(name,blob) {const p=path.join(output,name);await writeFile(p,new Uint8Array(await blob.arrayBuffer()));return p;}
  const model=await save('model.zip',f.modelBlob), training=await save('training.zip',f.trainingBlob), result=await save('result.zip',f.result);
  await page.goto(origin+'/eval-web/');
  assert.equal(await page.locator('#create').isDisabled(),true);
  await page.locator('#model-file').setInputFiles(model);
  await page.locator('#training-files').setInputFiles(training);
  await page.locator('#result-files').setInputFiles(result);
  await page.locator('#validate').click();
  await page.waitForFunction(()=>!document.getElementById('validate').disabled);
  assert.ok(!await page.locator('#validation-summary').isHidden(), await page.locator('#status').textContent() + JSON.stringify(errors));
  await page.locator('#validation-summary').waitFor({state:'visible'});
  assert.equal(await page.locator('#case-count').textContent(),'1 matched / 1 (n=1)');
  await page.locator('#domain').fill('Synthetic browser E2E; oblique MRI');
  assert.equal(await page.locator('#create').isDisabled(),true);
  await page.locator('#attestation').check();
  await page.locator('#create').click();
  await page.locator('#ready').waitFor({state:'visible'});
  const downloadPromise=page.waitForEvent('download');await page.locator('#download').click();
  const download=await downloadPromise;const requestPath=path.join(output,download.suggestedFilename());await download.saveAs(requestPath);
  const python=process.env.EVAL_PYTHON || path.join(root,'.venv','Scripts','python.exe');
  const backendResult=execFileSync(python,[path.join(root,'ColabNotebooks/evalref3d_backend.py'),requestPath,'--output-dir',path.join(output,'certificates')],{encoding:'utf8'});
  assert.match(backendResult,/n=1/);
  await page.screenshot({path:path.join(output,'desktop.png'),fullPage:true});
  await page.setViewportSize({width:390,height:844});
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth));
  await page.screenshot({path:path.join(output,'mobile.png'),fullPage:true});
  await page.locator('#domain').fill('Changed domain');
  assert.equal(await page.locator('#ready').isHidden(),true);
  await page.locator('#training-files').setInputFiles([]);
  assert.equal(await page.locator('#attestation').isChecked(),false);
  assert.equal(await page.locator('#create').isDisabled(),true);
  const bad=await fixture(2,{mutateResult:r=>r.model.model_sha256='f'.repeat(64)});
  await page.locator('#training-files').setInputFiles(await save('bad-training.zip',bad.trainingBlob));
  await page.locator('#result-files').setInputFiles(await save('bad-result.zip',bad.result));
  await page.locator('#validate').click();
  await page.waitForFunction(()=>document.getElementById('status').textContent.startsWith('Rejected:'));
  assert.equal(await page.locator('#validation-summary').isHidden(),true);
  assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
  await writeFile(path.join(output,'report.json'),JSON.stringify({passed:true,synthetic:true,case_count:1,externalRequests:external,pageErrors:errors,backendResult},null,2));
  console.log('Browser CPU E2E passed: upload, pair, attest, download, certificate, mobile, stale-state reset, mismatch rejection.');
} finally {if(browser) await browser.close(); await new Promise(resolve=>server.close(resolve));}
