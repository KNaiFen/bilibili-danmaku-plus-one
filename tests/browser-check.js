async (page) => {
  const results = [];
  const errors = [];
  const check = (condition, message) => {
    if (!condition) throw new Error(message);
    results.push(message);
  };
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => route.abort());
  await page.route('http://127.0.0.1:19222/123', route => route.fulfill({
    contentType: 'text/html',
    body: '<html><body style="margin:0"><div id="player" style="position:relative;width:960px;height:540px;background:#333"><div id="layer" style="position:absolute;inset:0;pointer-events:none"></div></div></body></html>'
  }));
  await page.route('**/danmaku-v2.js', route => route.fulfill({ contentType: 'application/javascript', path: 'generated/test-engine.js' }));
  await page.goto('http://127.0.0.1:19222/123');
  await page.addScriptTag({ path: 'bilibili-danmaku-plus-one.user.js' });
  await page.addScriptTag({ url: 'http://127.0.0.1:19222/danmaku-v2.js' });
  await page.evaluate(() => {
    window.engine = new LiveDanmakuEngine.default(document.getElementById('layer'), { userId: 0, isMobile: false, rnd: 'test' });
    engine.onSelect(() => {});
    engine.danmaku.magic.init();
  });
  await page.waitForFunction(() => !!engine.danmaku.core);
  await page.evaluate(() => {
    const core = engine.danmaku.core;
    core.setSetting('duration', 3);
    core.play();
    core.manager.renderTime = 0;
    core.manager.currentTime = 0;
    window.addDm = (id, mode) => {
      core.add({ text: id, mode, dmid: id, size: 25, color: 16777215, stime: core.manager.currentTime * 1000 });
    };
    window.dmState = id => {
      const dm = core.manager.visualArray.find(item => item.textData.dmid === id);
      if (!dm) return null;
      const rect = dm.element.getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, hover: !!dm.isHover,
        end: dm.endTime, time: core.manager.renderTime, life: dm.endTime - core.manager.renderTime,
        className: dm.element.className, paused: getComputedStyle(dm.element).animationPlayState };
    };
    addDm('Fixed top', 5);
    addDm('Rolling', 1);
  });
  const state = id => page.evaluate(id => dmState(id), id);
  await page.waitForFunction(() => dmState('Fixed top')?.className.includes('show'));
  const fixed = await state('Fixed top');
  await page.mouse.move(fixed.x + fixed.width / 2, fixed.y + fixed.height / 2);
  await page.waitForFunction(() => dmState('Fixed top')?.hover);
  const rollingBefore = await state('Rolling');
  await page.waitForTimeout(3700);
  const heldFixed = await state('Fixed top');
  check(heldFixed?.hover && heldFixed.time > heldFixed.end, 'fixed top survives its original expiration while hovered');
  const rollingAfter = await state('Rolling');
  check(rollingAfter && rollingAfter.x < rollingBefore.x - 100, 'other danmaku keep moving');
  await page.mouse.move(400, 300);
  await page.waitForFunction(() => dmState('Fixed top') && !dmState('Fixed top').hover);
  check((await state('Fixed top')).life > 2, 'leaving preserves the remaining fixed-danmaku lifetime');
  await page.waitForFunction(() => !dmState('Fixed top'), { timeout: 6000 });
  check(true, 'fixed danmaku expires normally after leaving');

  await page.evaluate(() => addDm('Rolling hold', 1));
  await page.waitForFunction(() => { const dm = dmState('Rolling hold'); return dm && dm.x > 200 && dm.x + dm.width < 930; });
  const rolling = await state('Rolling hold');
  await page.mouse.move(rolling.x + rolling.width / 2, rolling.y + rolling.height / 2);
  await page.waitForFunction(() => dmState('Rolling hold')?.hover);
  const heldRoll = await state('Rolling hold');
  await page.waitForTimeout(9500);
  const stillRoll = await state('Rolling hold');
  check(stillRoll?.hover && Math.abs(stillRoll.x - heldRoll.x) < 1, 'rolling position stays fixed beyond original expiration');
  await page.screenshot({ path: 'output/playwright/hover-rolling.png' });
  await page.mouse.move(400, 300);
  await page.waitForFunction(() => !dmState('Rolling hold')?.hover);
  const resumedRoll = await state('Rolling hold');
  await page.waitForTimeout(500);
  check((await state('Rolling hold')).x < resumedRoll.x - 30, 'rolling movement resumes after leaving');

  await page.evaluate(() => addDm('Fixed bottom', 4));
  await page.waitForFunction(() => dmState('Fixed bottom')?.className.includes('show'));
  const bottom = await state('Fixed bottom');
  await page.mouse.move(bottom.x + bottom.width / 2, bottom.y + bottom.height / 2);
  await page.waitForFunction(() => dmState('Fixed bottom')?.hover);
  await page.evaluate(() => engine.danmaku.core.pause());
  const pausedLife = (await state('Fixed bottom')).life;
  await page.waitForTimeout(1200);
  await page.mouse.move(400, 300);
  await page.waitForFunction(() => !dmState('Fixed bottom')?.hover);
  check(Math.abs((await state('Fixed bottom')).life - pausedLife) < 0.15, 'video pause does not add wall-clock time to danmaku lifetime');
  await page.evaluate(() => engine.danmaku.core.play());
  await page.mouse.move(bottom.x + bottom.width / 2, bottom.y + bottom.height / 2);
  await page.waitForFunction(() => dmState('Fixed bottom')?.hover);
  await page.waitForTimeout(3300);
  check(!!(await state('Fixed bottom'))?.hover, 'fixed bottom survives expiration while hovered');
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  check(!(await state('Fixed bottom')).hover, 'window blur releases the held danmaku');

  await page.mouse.move(600, 300);
  await page.evaluate(() => {
    engine.danmaku.core.clear();
    addDm('Stationary pointer', 1);
  });
  await page.waitForFunction(() => dmState('Stationary pointer')?.className.includes('show'));
  const incoming = await state('Stationary pointer');
  await page.mouse.move(700, incoming.y + incoming.height / 2);
  await page.waitForFunction(() => dmState('Stationary pointer')?.hover);
  check(true, 'moving danmaku is caught by a stationary pointer');
  await page.evaluate(() => engine.danmaku.core.clear());
  await page.waitForTimeout(100);
  await page.mouse.move(400, 300);
  await page.evaluate(() => addDm('Recycled node', 5));
  await page.waitForFunction(() => dmState('Recycled node')?.className.includes('show'));
  check(!(await state('Recycled node')).hover, 'recycled node is not left paused after player clear');
  const recycled = await state('Recycled node');
  await page.mouse.move(recycled.x + recycled.width / 2, recycled.y + recycled.height / 2);
  await page.waitForFunction(() => dmState('Recycled node')?.hover);
  await page.mouse.move(1100, 600);
  await page.waitForFunction(() => !dmState('Recycled node')?.hover);
  check(true, 'leaving the player restores danmaku');

  await page.evaluate(() => {
    const menu = document.createElement('ul');
    menu.id = 'context-menu';
    menu.style.cssText = 'position:absolute;top:80px;left:30px;background:white';
    menu.innerHTML = '<li data-plus1-injected="1" data-plus1-hooked="1" data-plus1-text="+1 弹幕复读"><span>+1 弹幕复读</span></li><li><span>视频统计信息</span></li>';
    document.getElementById('player').append(menu);
    window.showSelection = text => {
      menu.querySelectorAll('[data-auto-remove]').forEach(item => item.remove());
      const item = document.createElement('li');
      item.dataset.autoRemove = '1';
      item.innerHTML = '<span></span><ul style="display:none"><li>举报选中弹幕</li><li>复制弹幕</li></ul>';
      item.querySelector('span').textContent = text;
      menu.prepend(item);
    };
    document.cookie = 'bili_jct=test-only; path=/';
    window.sent = [];
    window.fetch = async (url, options) => { sent.push(options.body.get('msg')); return {ok:true,json:async()=>({code:0})}; };
    document.body.addEventListener('mousedown', () => menu.querySelectorAll('[data-auto-remove]').forEach(item => item.remove()));
  });
  await page.waitForFunction(() => !document.querySelector('[data-plus1-injected]'));
  check(true, 'stale plus-one button is removed from a normal menu');
  await page.evaluate(() => showSelection('First selected danmaku'));
  await page.waitForFunction(() => document.querySelector('[data-plus1-text]')?.dataset.plus1Text === 'First selected danmaku');
  check(await page.locator('[data-plus1-injected]').count() === 1, 'one first-level button appears before opening the hidden submenu');
  await page.evaluate(() => showSelection('Second selected danmaku'));
  await page.waitForFunction(() => document.querySelector('[data-plus1-text]')?.dataset.plus1Text === 'Second selected danmaku');
  // DOM click avoids the real player's hit-test listener replacing this synthetic selection.
  await page.evaluate(() => document.querySelector('[data-plus1-injected]').click());
  await page.waitForFunction(() => sent.length === 1);
  check(await page.evaluate(() => sent[0] === 'Second selected danmaku'), 'repeat sends the current selection even when close removes its DOM');
  await page.waitForFunction(() => !document.querySelector('[data-plus1-injected]'));
  await page.waitForTimeout(400);
  await page.evaluate(() => showSelection('+1 弹幕复读'));
  await page.waitForFunction(() => !!document.querySelector('[data-plus1-injected]'));
  await page.evaluate(() => document.querySelector('[data-plus1-injected]').click());
  check(await page.evaluate(() => sent[1] === '+1 弹幕复读'), 'a real danmaku matching the button label remains valid');
  check(errors.length === 0, 'no uncaught JavaScript errors');
  return { passed: results.length, results };
}
