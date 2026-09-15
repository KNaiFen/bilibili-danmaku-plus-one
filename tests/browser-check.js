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
    engine.danmaku.core.clear();
    const menu = document.createElement('ul');
    menu.id = 'hover-context-menu';
    menu.style.cssText = 'position:absolute;top:80px;left:30px;background:white;opacity:0';
    document.getElementById('player').append(menu);
    engine.onSelect(items => {
      setTimeout(() => {
        menu.innerHTML = '<li data-auto-remove="1"><span></span><ul style="position:absolute;left:100%;top:0;background:white"><li>复制弹幕</li></ul></li><li><span>视频统计信息</span></li>';
        menu.querySelector('span').textContent = items[0].text;
        menu.style.opacity = '1';
      }, 60);
    });
    document.cookie = 'bili_jct=test-only; path=/';
    window.menuSent = [];
    window.fetch = async (url, options) => { menuSent.push(options.body.get('msg')); return {ok:true,json:async()=>({code:0})}; };
    window.closeHoverMenu = () => { menu.style.opacity = '0'; };
    document.body.addEventListener('mousedown', event => {
      if (!menu.contains(event.target)) closeHoverMenu();
    });
    addDm('Menu fixed', 5);
  });
  await page.waitForFunction(() => dmState('Menu fixed')?.className.includes('show'));
  const menuFixed = await state('Menu fixed');
  await page.mouse.move(menuFixed.x + menuFixed.width / 2, menuFixed.y + menuFixed.height / 2);
  await page.waitForFunction(() => dmState('Menu fixed')?.hover);
  await page.mouse.click(menuFixed.x + menuFixed.width / 2, menuFixed.y + menuFixed.height / 2, { button: 'right' });
  await page.waitForFunction(() => document.querySelector('#hover-context-menu')?.style.opacity === '1');
  await page.locator('#hover-context-menu > li').first().hover();
  await page.waitForTimeout(3600);
  check(!!(await state('Menu fixed'))?.hover, 'fixed danmaku stays alive while using its right-click menu');
  await page.evaluate(() => closeHoverMenu());
  await page.waitForFunction(() => !dmState('Menu fixed')?.hover);
  check((await state('Menu fixed')).life > 1, 'opacity-only menu close releases the fixed danmaku with remaining time');

  await page.mouse.move(400, 300);
  await page.evaluate(() => addDm('Menu rolling', 1));
  await page.waitForFunction(() => { const dm = dmState('Menu rolling'); return dm && dm.x > 200 && dm.x + dm.width < 930; });
  const menuRoll = await state('Menu rolling');
  await page.mouse.move(menuRoll.x + menuRoll.width / 2, menuRoll.y + menuRoll.height / 2);
  await page.waitForFunction(() => dmState('Menu rolling')?.hover);
  await page.mouse.click(menuRoll.x + menuRoll.width / 2, menuRoll.y + menuRoll.height / 2, { button: 'right' });
  await page.waitForFunction(() => document.querySelector('#hover-context-menu [data-plus1-text]')?.dataset.plus1Text === 'Menu rolling');
  await page.locator('#hover-context-menu ul > li').hover();
  const heldInMenu = await state('Menu rolling');
  await page.waitForTimeout(800);
  check(Math.abs((await state('Menu rolling')).x - heldInMenu.x) < 1, 'rolling danmaku stays still while hovering its submenu');
  await page.locator('#hover-context-menu [data-plus1-injected]').click();
  await page.waitForFunction(() => !dmState('Menu rolling')?.hover);
  check(await page.evaluate(() => menuSent[0] === 'Menu rolling'), 'clicking plus-one sends the held danmaku and releases it when the menu closes');

  await page.mouse.move(400, 300);
  await page.evaluate(() => addDm('Menu stay hovered', 5));
  await page.waitForFunction(() => dmState('Menu stay hovered')?.className.includes('show'));
  const stay = await state('Menu stay hovered');
  await page.mouse.move(stay.x + stay.width / 2, stay.y + stay.height / 2);
  await page.waitForFunction(() => dmState('Menu stay hovered')?.hover);
  await page.mouse.click(stay.x + stay.width / 2, stay.y + stay.height / 2, { button: 'right' });
  await page.waitForFunction(() => document.querySelector('#hover-context-menu [data-plus1-text]')?.dataset.plus1Text === 'Menu stay hovered');
  await page.waitForTimeout(100);
  await page.evaluate(() => document.getElementById('hover-context-menu').remove());
  await page.waitForTimeout(150);
  check(!!(await state('Menu stay hovered'))?.hover, 'closing menu keeps pause when the pointer remains over the danmaku');
  await page.mouse.move(400, 300);
  await page.waitForFunction(() => !dmState('Menu stay hovered')?.hover);
  check(true, 'leaving after menu removal restores normal hover behavior');
  await page.evaluate(() => engine.onSelect(() => {}));
  await page.mouse.move(stay.x + stay.width / 2, stay.y + stay.height / 2);
  await page.waitForFunction(() => dmState('Menu stay hovered')?.hover);
  await page.mouse.click(stay.x + stay.width / 2, stay.y + stay.height / 2, { button: 'right' });
  await page.mouse.move(400, 300);
  await page.waitForFunction(() => !dmState('Menu stay hovered')?.hover);
  check(true, 'missing context menu cannot leave a permanent pause');

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

  await page.mouse.move(1100, 600);
  await page.evaluate(() => {
    document.getElementById('context-menu').remove();
    engine.danmaku.core.clear();
    window.copied = [];
    window.GM_setClipboard = text => copied.push(text);
    window.sent = [];
    window.playerClicks = 0;
    document.getElementById('player').addEventListener('click', () => playerClicks++);
    addDm('浮窗复制和复读 [表情]', 5);
  });
  const toolbar = page.locator('#danmaku-plus1-toolbar');
  const awaitToolbar = async id => {
    await page.waitForFunction(id => dmState(id)?.className.includes('show'), id);
    const dm = await state(id);
    const viewport = page.viewportSize();
    const x = Math.max(8, Math.min(dm.x + dm.width / 2, Math.min(960, viewport.width) - 8));
    await page.mouse.move(x, dm.y + dm.height / 2);
    await page.waitForFunction(id => dmState(id)?.hover && !document.getElementById('danmaku-plus1-toolbar').hidden, id);
    return dm;
  };
  const assertBounds = async label => {
    const bounds = await page.evaluate(() => {
      const bar = document.getElementById('danmaku-plus1-toolbar');
      const panel = bar.getBoundingClientRect();
      const area = engine.config.container.getBoundingClientRect();
      const buttons = [...bar.querySelectorAll('button')].map(button => {
        const rect = button.getBoundingClientRect();
        return { inside: rect.left >= panel.left && rect.right <= panel.right && rect.top >= panel.top && rect.bottom <= panel.bottom,
          fits: button.scrollWidth <= button.clientWidth, hit: document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2) === button };
      });
      return { inside: panel.left >= Math.max(0, area.left) && panel.right <= Math.min(innerWidth, area.right)
        && panel.top >= Math.max(0, area.top) && panel.bottom <= Math.min(innerHeight, area.bottom), buttons };
    });
    check(bounds.inside && bounds.buttons.every(button => button.inside && button.fits && button.hit), label);
  };
  const toolbarDm = await awaitToolbar('浮窗复制和复读 [表情]');
  check(await toolbar.getAttribute('data-placement') === 'bottom', 'toolbar appears below top danmaku');
  check(await toolbar.locator('[data-action="reply"]').isDisabled(), 'reply is a disabled placeholder');
  await assertBounds('toolbar and all three buttons are visible and clickable inside the player');
  const barRect = await toolbar.boundingBox();
  await page.mouse.move(barRect.x + barRect.width / 2, (toolbarDm.y + toolbarDm.height + barRect.y) / 2);
  await page.waitForTimeout(250);
  check(!!(await state('浮窗复制和复读 [表情]'))?.hover, 'crossing the gap from danmaku to toolbar keeps it paused');
  await toolbar.locator('[data-action="copy"]').click();
  check(await page.evaluate(() => copied[0] === '浮窗复制和复读 [表情]'), 'copy uses original danmaku text from engine data');
  check(await toolbar.locator('[data-action="copy"]').textContent() === '已复制', 'copy displays success without resizing the toolbar');
  await toolbar.locator('[data-action="repeat"]').click();
  await page.waitForFunction(() => sent.length === 1);
  check(await page.evaluate(() => sent[0] === '浮窗复制和复读 [表情]' && playerClicks === 0), 'toolbar repeat sends correct text without clicking the player');
  await page.waitForTimeout(3300);
  check(!!(await state('浮窗复制和复读 [表情]'))?.hover, 'toolbar hover protects fixed danmaku past its expiration');
  await page.screenshot({ path: 'output/playwright/toolbar-top.png' });
  await page.mouse.move(400, 300);
  await page.waitForFunction(() => !dmState('浮窗复制和复读 [表情]')?.hover && document.getElementById('danmaku-plus1-toolbar').hidden);
  check(true, 'leaving both toolbar and text closes the toolbar and resumes danmaku');

  await page.evaluate(() => {
    engine.danmaku.core.clear();
    addDm('底部弹幕', 4);
  });
  await awaitToolbar('底部弹幕');
  check(await toolbar.getAttribute('data-placement') === 'top', 'bottom danmaku flips toolbar above the text');
  check(await toolbar.locator('[data-action="copy"]').textContent() === '复制', 'copy feedback resets for a different danmaku');
  await assertBounds('bottom toolbar stays completely inside player bounds');
  await toolbar.locator('[data-action="copy"]').hover();
  await page.screenshot({ path: 'output/playwright/toolbar-bottom.png' });
  await page.mouse.move(1100, 600);
  await page.waitForFunction(() => document.getElementById('danmaku-plus1-toolbar').hidden);

  for (const edge of ['left', 'right']) {
    await page.evaluate(edge => {
      engine.danmaku.core.clear();
      addDm('边缘弹幕 ' + edge, 5);
    }, edge);
    await page.waitForFunction(id => dmState(id)?.className.includes('show'), '边缘弹幕 ' + edge);
    await page.evaluate(edge => {
      const dm = engine.danmaku.core.manager.visualArray.find(item => item.textData.dmid === '边缘弹幕 ' + edge);
      dm.element.style.setProperty('left', edge === 'left' ? '-20px' : '900px', 'important');
      dm.element.style.setProperty('transform', 'none', 'important');
    }, edge);
    await awaitToolbar('边缘弹幕 ' + edge);
    await assertBounds(`${edge} edge toolbar is clamped and all buttons remain reachable`);
    await toolbar.locator('[data-action="copy"]').hover();
    await page.screenshot({ path: `output/playwright/toolbar-${edge}.png` });
    await page.mouse.move(1100, 600);
    await page.waitForFunction(() => document.getElementById('danmaku-plus1-toolbar').hidden);
  }

  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => {
    engine.danmaku.core.clear();
    document.getElementById('player').style.width = '390px';
    document.getElementById('player').style.height = '220px';
    engine.resize();
  });
  await page.waitForTimeout(100);
  await page.evaluate(() => addDm('窄窗口底部弹幕', 4));
  await awaitToolbar('窄窗口底部弹幕');
  await assertBounds('narrow 390px player keeps every toolbar button inside its bounds');
  await toolbar.locator('[data-action="copy"]').hover();
  await page.screenshot({ path: 'output/playwright/toolbar-mobile.png' });
  await page.mouse.move(300, 600);
  await page.waitForFunction(() => document.getElementById('danmaku-plus1-toolbar').hidden);
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.evaluate(() => {
    engine.danmaku.core.clear();
    document.getElementById('player').style.cssText = 'position:relative;width:960px;height:540px;background:#333;transform:scale(.75);transform-origin:top left;margin:30px';
    engine.resize();
  });
  await page.waitForTimeout(100);
  await page.evaluate(() => addDm('缩放播放器弹幕', 4));
  await awaitToolbar('缩放播放器弹幕');
  await assertBounds('scaled and offset player keeps toolbar aligned to its own coordinates');
  await page.mouse.move(1100, 600);
  await page.waitForFunction(() => document.getElementById('danmaku-plus1-toolbar').hidden);
  await page.evaluate(async () => {
    engine.danmaku.core.clear();
    const player = document.getElementById('player');
    player.style.transform = 'none';
    player.style.margin = '0';
    await player.requestFullscreen();
    engine.resize();
  });
  await page.waitForTimeout(150);
  await page.evaluate(() => addDm('全屏弹幕', 5));
  await awaitToolbar('全屏弹幕');
  check(await page.evaluate(() => document.fullscreenElement.contains(document.getElementById('danmaku-plus1-toolbar'))), 'toolbar remains in the fullscreen player DOM');
  await assertBounds('fullscreen toolbar is visible and clickable');
  await page.screenshot({ path: 'output/playwright/toolbar-fullscreen.png' });
  await page.evaluate(() => document.exitFullscreen());
  check(errors.length === 0, 'no uncaught JavaScript errors');
  return { passed: results.length, results };
}
