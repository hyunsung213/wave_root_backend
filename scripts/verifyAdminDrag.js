/* Browser-level check for the administrator camera placement controls. */
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET ||= 'admin-drag-check-secret-at-least-32-characters';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const app = require('../src/app');

const chromePath = process.env.CHROME_PATH ||
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'admin-drag-check-'));
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function run() {
  const server = app.listen(0, '127.0.0.1');
  const chrome = spawn(chromePath, [
    '--headless=new', '--no-sandbox', '--disable-gpu', '--window-size=1800,1300',
    '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'
  ], { windowsHide: true, stdio: 'ignore' });
  let socket;
  try {
    await new Promise((resolve) => server.once('listening', resolve));
    const portFile = path.join(profile, 'DevToolsActivePort');
    for (let index = 0; !fs.existsSync(portFile) && index < 80; index++) await delay(100);
    assert.ok(fs.existsSync(portFile), 'Chrome DevTools did not start');
    const devtoolsPort = Number(fs.readFileSync(portFile, 'utf8').split('\n')[0]);
    const targets = await (await fetch(`http://127.0.0.1:${devtoolsPort}/json/list`)).json();
    const target = targets.find((item) => item.type === 'page');
    assert.ok(target, 'Chrome did not create a page');
    socket = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
    let nextId = 0;
    const pending = new Map();
    socket.onmessage = ({ data }) => {
      const message = JSON.parse(data);
      if (!message.id) return;
      const job = pending.get(message.id);
      if (!job) return;
      pending.delete(message.id);
      message.error ? job.reject(new Error(message.error.message)) : job.resolve(message.result);
    };
    function command(method, params = {}) {
      const id = ++nextId;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        socket.send(JSON.stringify({ id, method, params }));
      });
    }
    async function evaluate(expression) {
      const reply = await command('Runtime.evaluate', { expression, returnByValue: true,
        awaitPromise: true });
      if (reply.exceptionDetails) throw new Error(reply.exceptionDetails.text);
      return reply.result.value;
    }
    await command('Page.enable');
    await command('Runtime.enable');
    await command('Emulation.setDeviceMetricsOverride', { width: 1800, height: 1300,
      deviceScaleFactor: 1, mobile: false });
    await command('Page.addScriptToEvaluateOnNewDocument', {
      source: `window.Chart=function(){};Chart.defaults={font:{},plugins:{legend:{labels:{}}}};Chart.register=()=>{};`
    });
    await command('Page.navigate', {
      url: `http://127.0.0.1:${server.address().port}/admin/`
    });
    for (let index = 0; index < 80; index++) {
      if (await evaluate("!!document.getElementById('perspectiveEdit') && document.readyState==='complete'")) break;
      await delay(100);
    }
    await evaluate(`show(true);
      document.querySelectorAll('.view').forEach(view=>view.classList.remove('active'));
      $('view-camera').classList.add('active');
      startCameraPolling=()=>{};
      cameraState.id='c110-1';
      cameraState.savedPerspectiveCorners=[[0,0],[1,0],[1,1],[0,1]];
      cameraState.perspectiveCorners=structuredClone(cameraState.savedPerspectiveCorners);
      cameraState.layoutLoaded=true;
      cameraState.zones=Object.fromEntries(Array.from({length:18},(_,i)=>[String(i+1),
        [i%6/6,Math.floor(i/6)/3,(i%6+1)/6,(Math.floor(i/6)+1)/3]]));
      updateCameraControls();`);
    async function dragTool(selector, xFraction, yFraction) {
      const bounds = await evaluate(`(()=>{
        const tool=document.querySelector(${JSON.stringify(selector)});
        tool.scrollIntoView({block:'nearest'});
        const a=tool.getBoundingClientRect(), b=$('cameraStage').getBoundingClientRect();
        return {from:[a.left+a.width/2,a.top+a.height/2],
          to:[b.left+b.width*${xFraction},b.top+b.height*${yFraction}]};
      })()`);
      const [x0, y0] = bounds.from;
      const [x1, y1] = bounds.to;
      await command('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x0, y: y0 });
      await command('Input.dispatchMouseEvent', { type: 'mousePressed', x: x0, y: y0,
        button: 'left', clickCount: 1 });
      await command('Input.dispatchMouseEvent', { type: 'mouseMoved', x: (x0 + x1) / 2,
        y: (y0 + y1) / 2, buttons: 1 });
      await command('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x1, y: y1,
        buttons: 1 });
      await command('Input.dispatchMouseEvent', { type: 'mouseReleased', x: x1, y: y1,
        button: 'left', clickCount: 1 });
    }
    await evaluate("$('perspectiveEdit').click()");
    assert.equal(await evaluate("cameraState.perspectiveCorners.filter(Array.isArray).length"), 0);
    assert.equal(await evaluate("!$('perspectivePalette').hidden"), true);
    await dragTool('[data-perspective-tool="0"]', 0.1, 0.1);
    assert.equal(await evaluate("cameraState.perspectiveCorners.filter(Array.isArray).length"), 1);
    await evaluate("$('perspectiveCancel').click();$('gridLayoutEdit').click()");
    assert.equal(await evaluate("!$('gridPalette').hidden"), true);
    await dragTool('[data-grid-tool="0"]', 0.1, 0.1);
    await dragTool('[data-grid-tool="1"]', 0.45, 0.85);
    assert.equal(await evaluate("validGridLayouts(cameraState.grids)"), true);
    await evaluate("$('gridLayoutAdd').click()");
    await dragTool('[data-grid-tool="0"]', 0.55, 0.1);
    await dragTool('[data-grid-tool="1"]', 0.9, 0.85);
    assert.equal(await evaluate("cameraState.grids.length"), 2);
    assert.equal(await evaluate("validGridLayouts(cameraState.grids)"), true);
    assert.equal(await evaluate("$('cameraOverlay').querySelectorAll('.camera-grid-boundary').length"), 2);
    await evaluate("$('gridLayoutCancel').click();cameraState.layoutCustomized=false;cameraState.layoutEditing=true;cameraState.grids=[];cameraState.selectedGridId=null;updateCameraControls()");
    await dragStage(0.12,0.18,0.38,0.46, "$('cameraOverlay').querySelector('.camera-zone-draft')?.getAttribute('width')");
    assert.equal(await evaluate("cameraState.grids.length"), 1);
    assert.equal(await evaluate("validGridLayouts(cameraState.grids)"), true);
    await evaluate("$('gridLayoutCancel').click();cameraState.layoutCustomized=false;cameraState.layoutEditing=false;cameraState.editing=true;cameraState.mode='grid';cameraState.zone='1';cameraState.drawMode=true;updateCameraControls()");
    await dragStage(0.02,0.05,0.15,0.28);
    const drawnZone=await evaluate("cameraState.zones['1']");
    assert.ok(drawnZone.every((value,index)=>Math.abs(value-[0.02,0.05,0.15,0.28][index])<0.002));
    const originalZone2=await evaluate("cameraState.zones['2']");
    await evaluate("cameraState.drawMode=true;updateCameraControls()");
    await dragStage(0.15,0.1,0.3,0.28);
    assert.deepEqual(await evaluate("cameraState.zones['1']"),drawnZone);
    assert.deepEqual(await evaluate("cameraState.zones['2']"),originalZone2);
    assert.equal(await evaluate("validGridLayouts([{id:'grid-1',anchors:[[0.05,0.05],[0.3,0.3]]},{id:'grid-2',anchors:[[0.2,0.2],[0.4,0.4]]}])"),false);
    console.log('Browser drag check passed: palette placement, rectangle drawing, and overlap protection');

    async function dragStage(x0,y0,x1,y1,draftWidthExpression){
      await evaluate("$('cameraOverlay').scrollIntoView({block:'center'});$('cameraStage').scrollIntoView({block:'center'})");
      const bounds=await evaluate(`(()=>{const r=$('cameraStage').getBoundingClientRect();return {from:[r.left+r.width*${x0},r.top+r.height*${y0}],to:[r.left+r.width*${x1},r.top+r.height*${y1}]}})()`);
      await command('Input.dispatchMouseEvent',{type:'mouseMoved',x:bounds.from[0],y:bounds.from[1]});
      await command('Input.dispatchMouseEvent',{type:'mousePressed',x:bounds.from[0],y:bounds.from[1],button:'left',clickCount:1});
      if(draftWidthExpression)assert.equal(await evaluate("$('cameraOverlay').hasPointerCapture(cameraState.gridDraw.pointerId)"),true,'grid drawing must capture the pointer');
      await command('Input.dispatchMouseEvent',{type:'mouseMoved',x:bounds.to[0],y:bounds.to[1],buttons:1});
      if(draftWidthExpression){
        const draftWidth=Number(await evaluate(draftWidthExpression));
        assert.ok(draftWidth>0,'the in-progress grid rectangle should remain visible while dragging');
      }
      await command('Input.dispatchMouseEvent',{type:'mouseReleased',x:bounds.to[0],y:bounds.to[1],button:'left',clickCount:1});
    }
  } finally {
    socket?.close();
    chrome.kill();
    await new Promise((resolve) => server.close(resolve));
    const resolved = path.resolve(profile);
    if (resolved.startsWith(path.resolve(os.tmpdir()) + path.sep)) {
      for (let index = 0; index < 10; index++) {
        try { fs.rmSync(resolved, { recursive: true, force: true }); break; }
        catch { await delay(100); }
      }
    }
  }
}

run().catch((error) => { console.error(error); process.exitCode = 1; });
