async (page) => {
  const results = [];
  const errors = [];
  const check = (condition, message) => {
    if (!condition) throw new Error(message);
    results.push(message);
  };
  const waitForFunction = page.waitForFunction.bind(page);
  page.waitForFunction = async (...args) => {
    try { return await waitForFunction(...args); }
    catch (error) {
      throw new Error(`${error.message}\nWaiting for: ${args[0]} (${args[1]})\nLast check: ${results.at(-1)}\nPage errors: ${errors.join('; ')}`);
    }
  };
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    window.scriptMenus = [];
    window.GM_registerMenuCommand = (label, command) => scriptMenus.push({ label, command });
    const storedKey = 'test-gm-plus1_toast_enabled';
    if (localStorage.getItem(storedKey) === null) localStorage.setItem(storedKey, 'false');
    window.GM_getValue = (key, fallback) => {
      const raw = localStorage.getItem('test-gm-' + key);
      return raw === null ? fallback : JSON.parse(raw);
    };
    window.GM_setValue = (key, value) => localStorage.setItem('test-gm-' + key, JSON.stringify(value));
  });
  await page.route('**/*', route => route.abort());
  await page.route('http://127.0.0.1:19222/123', route => route.fulfill({
    contentType: 'text/html',
    body: '<html><body style="margin:0"><div id="player" style="position:relative;width:960px;height:540px;background:#333"><div id="layer" style="position:absolute;inset:0;pointer-events:none"></div></div></body></html>'
  }));
  await page.route('**/danmaku-v2.js', route => route.fulfill({ contentType: 'application/javascript', path: 'generated/test-engine.js' }));
  await page.goto('http://127.0.0.1:19222/123');
  await page.addScriptTag({ path: 'bilibili-danmaku-plus-one.user.js' });
  const settings = page.locator('#danmaku-plus1-settings dialog');
  const successToggle = settings.getByRole('switch', { name: '复读成功提示' });
  const openSettings = () => page.evaluate(() => scriptMenus[0].command());
  const assertSettingsBounds = async label => {
    check(await settings.evaluate(dialog => {
      const rect = dialog.getBoundingClientRect();
      return rect.width > 0 && rect.left >= 0 && rect.top >= 0
        && rect.right <= innerWidth && rect.bottom <= innerHeight
        && dialog.scrollWidth <= dialog.clientWidth
        && [...dialog.querySelectorAll('button, input')].every(control => {
          const bounds = control.getBoundingClientRect();
          return bounds.left >= rect.left && bounds.right <= rect.right
            && (dialog.scrollHeight > dialog.clientHeight || (bounds.top >= rect.top && bounds.bottom <= rect.bottom));
        });
    }), label);
  };
  check(await page.evaluate(() => scriptMenus.length === 1 && scriptMenus[0].label === '设置菜单'),
    'userscript menu contains only the settings entry');
  check(await page.locator('#danmaku-plus1-settings').count() === 0,
    'settings has no permanent page button and is created only when opened');
  await page.evaluate(() => {
    const focusTarget = document.createElement('button');
    focusTarget.id = 'settings-focus-target';
    focusTarget.textContent = 'Focus target';
    document.body.appendChild(focusTarget);
    focusTarget.focus();
    window.settingsPageClicks = 0;
    window.settingsPageKeys = 0;
    document.addEventListener('click', () => settingsPageClicks++);
    window.addEventListener('keydown', () => settingsPageKeys++);
  });
  await openSettings();
  check(await settings.isVisible() && !await successToggle.isChecked(),
    'menu opens the modal and preserves the existing disabled preference');
  await openSettings();
  check(await page.locator('#danmaku-plus1-settings').count() === 1,
    'reopening settings does not create duplicate panels');
  await assertSettingsBounds('desktop settings panel and controls fit the viewport');
  await page.screenshot({ path: 'output/playwright/settings-desktop.png' });
  await successToggle.focus();
  await successToggle.press('Space');
  check(await successToggle.isChecked() && await page.evaluate(() => GM_getValue('plus1_toast_enabled', false)),
    'keyboard toggle immediately saves the preference');
  await successToggle.press('Tab');
  check(await settings.getByRole('button', { name: '关闭设置' }).evaluate(button => button.getRootNode().activeElement === button),
    'Tab stays inside the modal');
  await settings.getByRole('button', { name: '关闭设置' }).click();
  check(!await settings.isVisible() && await page.evaluate(() => document.activeElement.id === 'settings-focus-target'),
    'close button closes the panel and restores previous focus');
  await openSettings();
  check(await successToggle.isChecked(), 'reopening shows the saved preference');
  await successToggle.click();
  await page.keyboard.press('Escape');
  check(!await settings.isVisible(), 'Escape closes settings');
  await openSettings();
  await page.mouse.click(8, 8);
  check(!await settings.isVisible() && await page.evaluate(() => settingsPageClicks === 0 && settingsPageKeys === 0),
    'backdrop closes settings without clicks or keyboard shortcuts reaching the page');
  await openSettings();
  for (const viewport of [{ width: 320, height: 568 }, { width: 640, height: 180 }]) {
    await page.setViewportSize(viewport);
    await assertSettingsBounds(`settings stays inside a ${viewport.width}x${viewport.height} viewport`);
    if (viewport.width === 320) await page.screenshot({ path: 'output/playwright/settings-mobile.png' });
  }
  await page.keyboard.press('Escape');
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.reload();
  await page.addScriptTag({ path: 'bilibili-danmaku-plus-one.user.js' });
  await openSettings();
  check(!await successToggle.isChecked(), 'saved preference survives a page reload');
  await successToggle.click();
  await page.keyboard.press('Escape');
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
      // Synchronize both clocks before injecting into an idle test player.
      core.timeController.updateTime();
      core.manager.renderTime = core.timeController.renderTime;
      core.manager.currentTime = core.timeController.currentTime;
      core.add({ text: id, mode, dmid: id, size: 25, color: 16777215, stime: core.config.fn.timelineSync() * 1000 });
      // Complete initialization together instead of injecting between the
      // engine scheduler's separate measurement and collision stages.
      core.manager.beforeCollisionCheck();
      core.manager.collisionCheck();
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
  await page.locator('#hover-context-menu ul > li').first().hover();
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
    window.showSelection = texts => {
      menu.querySelectorAll('[data-auto-remove]').forEach(item => item.remove());
      for (const text of (Array.isArray(texts) ? texts : [texts]).slice().reverse()) {
        const item = document.createElement('li');
        item.dataset.autoRemove = '1';
        item.innerHTML = '<span></span><ul style="display:none"><li class="submenu-item disabled">举报选中弹幕</li><li class="submenu-item">复制弹幕</li></ul>';
        item.querySelector('span').textContent = text;
        menu.prepend(item);
      }
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
  check(await page.locator('#context-menu > li > ul > [data-plus1-injected]').count() === 1
    && await page.locator('#context-menu > [data-plus1-injected]').count() === 0,
  'repeat appears only inside the selected danmaku submenu, including while hidden');
  check(await page.locator('[data-plus1-injected]').getAttribute('class') === 'submenu-item',
    'repeat inherits the native copy submenu style without disabled report styling');
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

  for (const index of [1, 0]) {
    await page.waitForTimeout(400);
    await page.evaluate(() => showSelection(['Nearby first', 'Nearby second']));
    await page.waitForFunction(() => document.querySelectorAll('#context-menu > li > ul > [data-plus1-injected]').length === 2);
    check(await page.evaluate(() => [...document.querySelectorAll('#context-menu > li[data-auto-remove]')]
      .every(item => item.querySelectorAll('[data-plus1-injected]').length === 1)),
    `both nearby danmaku have their own repeat button before choosing index ${index}`);
    await page.evaluate(index => document.querySelectorAll('#context-menu > li > ul > [data-plus1-injected]')[index].click(), index);
    check(await page.evaluate(index => sent[sent.length - 1] === ['Nearby first', 'Nearby second'][index], index),
      `submenu ${index} repeats its own text even when closing destroys both selections`);
    await page.waitForFunction(() => !document.querySelector('[data-plus1-injected]'));
  }

  await page.evaluate(() => {
    showSelection(['Same text', 'Same text']);
    const stale = document.createElement('li');
    stale.dataset.plus1Injected = '1';
    document.getElementById('context-menu').append(stale);
  });
  await page.waitForFunction(() => document.querySelectorAll('[data-plus1-injected]').length === 2
    && !document.querySelector('#context-menu > [data-plus1-injected]'));
  check(true, 'identical labels keep independent submenu buttons and old main-menu buttons are removed');
  await page.evaluate(() => {
    const first = document.querySelector('#context-menu > li[data-auto-remove]');
    first.querySelector('span').textContent = 'Updated in place';
    const button = first.querySelector('[data-plus1-injected]');
    button.after(button.cloneNode(true));
  });
  await page.waitForFunction(() => document.querySelectorAll('[data-plus1-injected]').length === 2
    && document.querySelector('[data-plus1-injected]').dataset.plus1Text === 'Updated in place');
  check(true, 'submenu updates refresh the matching text and remove duplicate buttons');
  await page.waitForTimeout(400);
  await page.evaluate(() => document.querySelector('[data-plus1-injected]').click());
  check(await page.evaluate(() => sent[sent.length - 1] === 'Updated in place'), 'reused submenu reads its current parent label when clicked');

  await page.evaluate(() => {
    showSelection('Lazy submenu');
    document.querySelector('#context-menu > li[data-auto-remove] > ul').remove();
  });
  await page.waitForTimeout(80);
  check(await page.locator('[data-plus1-injected]').count() === 0, 'no main-menu fallback is added before a submenu exists');
  await page.evaluate(() => {
    const submenu = document.createElement('ul');
    submenu.innerHTML = '<li>复制弹幕</li>';
    document.querySelector('#context-menu > li[data-auto-remove]').append(submenu);
  });
  await page.waitForFunction(() => document.querySelector('#context-menu > li > ul > [data-plus1-injected]')?.dataset.plus1Text === 'Lazy submenu');
  check(true, 'a submenu created later receives its own repeat button');

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
  check(await toolbar.locator('[data-action="reply"]').isDisabled(), 'reply is disabled when sender data is missing');
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
  check(await page.evaluate(() => [...document.body.children].some(element =>
    element.textContent === '弹幕+1成功' && element.style.opacity === '1')),
  'enabled setting shows the success toast after repeating');
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

  await page.evaluate(() => {
    // The saved HTML omits the lazy-loaded menu JS. Model its Vue controller
    // contract from app.js and keep using the real saved danmaku engine.
    const menuEl = document.createElement('div');
    menuEl.className = 'danmaku-menu';
    menuEl.style.cssText = 'position:fixed;left:980px;top:100px;display:none';
    menuEl.innerHTML = '<div class="at-this-guy"><a>@TA</a></div>';
    const input = document.createElement('textarea');
    input.id = 'native-reply-input';
    input.value = 'draft stays unchanged';
    document.body.append(menuEl, input);
    window.replyTargets = [];
    window.nativeMenuOpens = [];
    window.omitNativeAt = false;
    const child = { $el: menuEl, info: { uid: 999, username: 'Previous sender', content: 'old', idStr: 'old' } };
    let revision = 0;
    const menu = window.nativeReplyMenu = {
      $children: [child], show: false, danmakuMenuInfo: {},
      showMenu(x, y, info) {
        const current = ++revision;
        nativeMenuOpens.push({ ...info });
        this.show = true;
        this.danmakuMenuInfo = info;
        menuEl.style.display = '';
        // Leave the previous component props visible until Vue catches up.
        setTimeout(() => {
          if (current !== revision) return;
          child.info = info;
          menuEl.querySelector('.at-this-guy').style.display = omitNativeAt ? 'none' : '';
        }, 160);
      },
      hideMenu() { this.show = false; menuEl.style.display = 'none'; ++revision; }
    };
    child.$parent = menu;
    menuEl.__vue__ = child;
    menuEl.querySelector('a').addEventListener('click', () => {
      replyTargets.push({ ...child.info });
      input.dataset.replyUid = child.info.uid;
      input.focus();
      menu.hideMenu();
    });
    window.addReplyDm = (id, uid = 12345, extra = { show_reply: true }, mystery = false) => {
      engine.danmaku.core.clear();
      const info = [
        [0, 5, 25, 16777215, 0, 777, 0, 0, 0, 0, 0, '', 0, {}, null,
          { extra: JSON.stringify({ ...extra, id_str: id }), user: { base: { is_mystery: mystery } } }],
        '同一条弹幕', [uid, 'Sender ' + uid, 0, 0, 0, 0, 0], [], [1], [], 0, 0, 0,
        { ts: 123, ct: 'test-sign' }
      ];
      engine.handleSocketMessage({ cmd: 'DANMU_MSG', info });
    };
    addReplyDm('reply-first');
  });
  const replyButton = toolbar.locator('[data-action="reply"]');
  await awaitToolbar('reply-first');
  check(await replyButton.isEnabled(), 'socket sender UID, nickname and reply flags survive the real engine');
  check(await replyButton.getAttribute('title') === '回复 @Sender 12345', 'reply tooltip identifies the actual sender');
  await replyButton.click();
  await page.waitForFunction(() => replyTargets.length === 1);
  check(await page.evaluate(() => replyTargets[0].uid === 12345 && replyTargets[0].idStr === 'reply-first'
    && replyTargets[0].ts === 123 && replyTargets[0].sign === 'test-sign'), 'reply waits for native menu props and invokes @TA with the exact sender and message');
  check(await page.evaluate(() => document.activeElement.id === 'native-reply-input'
    && document.activeElement.value === 'draft stays unchanged' && sent.length === 1 && playerClicks === 0),
  'native @TA owns input focus without sending, changing the draft or clicking the player');
  check(!(await state('reply-first'))?.hover, 'reply releases the danmaku and hides the hover toolbar');

  await page.mouse.move(1100, 600);
  await page.evaluate(() => addReplyDm('reply-second', 67890));
  await awaitToolbar('reply-second');
  await replyButton.click();
  await page.waitForFunction(() => replyTargets.length === 2);
  check(await page.evaluate(() => replyTargets[1].uid === 67890 && replyTargets[1].idStr === 'reply-second'),
    'identical text from different senders never reuses the previous reply target');

  for (const scenario of ['missing-uid', 'mystery', 'reply-forbidden']) {
    await page.mouse.move(1100, 600);
    await page.evaluate(scenario => addReplyDm(scenario, scenario === 'missing-uid' ? 0 : 12345,
      { show_reply: scenario !== 'reply-forbidden' }, scenario === 'mystery'), scenario);
    await awaitToolbar(scenario);
    check(await replyButton.isDisabled(), `${scenario} cannot trigger a reply to an unknown or unsupported sender`);
  }

  await page.mouse.move(1100, 600);
  await page.evaluate(() => { omitNativeAt = true; addReplyDm('reply-no-action'); });
  await awaitToolbar('reply-no-action');
  await replyButton.click();
  await page.waitForFunction(() => nativeMenuOpens.length === 3 && !nativeReplyMenu.show);
  check(await page.evaluate(() => replyTargets.length === 2 && document.body.textContent.includes('B站未提供该弹幕的@TA操作')),
    'missing native @TA times out with feedback and closes only its own menu');

  await page.mouse.move(1100, 600);
  await page.evaluate(() => { omitNativeAt = false; addReplyDm('reply-cancelled'); });
  await awaitToolbar('reply-cancelled');
  await replyButton.click();
  await page.evaluate(() => nativeReplyMenu.showMenu(0, 0, {
    uid: 777, username: 'Manually selected', content: 'another message', idStr: 'manual'
  }));
  await page.waitForTimeout(300);
  check(await page.evaluate(() => replyTargets.length === 2 && nativeReplyMenu.show
    && nativeReplyMenu.danmakuMenuInfo.uid === 777), 'a newer manual menu selection cancels pending reply without clicking or closing it');
  await page.evaluate(() => {
    nativeReplyMenu.hideMenu();
    document.querySelector('.danmaku-menu').remove();
    document.getElementById('native-reply-input').remove();
  });
  await page.mouse.move(1100, 600);
  await page.evaluate(() => addReplyDm('reply-missing-menu'));
  await awaitToolbar('reply-missing-menu');
  await replyButton.click();
  check(await page.evaluate(() => replyTargets.length === 2
    && document.body.textContent.includes('未找到B站回复菜单')), 'missing native menu reports failure without sending a message');
  await page.mouse.move(1100, 600);

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
  await openSettings();
  await page.waitForFunction(() => !dmState('全屏弹幕')?.hover && document.getElementById('danmaku-plus1-toolbar').hidden);
  check(await settings.isVisible() && await page.evaluate(() =>
    document.fullscreenElement.contains(document.getElementById('danmaku-plus1-settings'))),
  'opening settings in fullscreen releases hovered danmaku and displays the modal above the player');
  await assertSettingsBounds('fullscreen settings controls remain visible and reachable');
  await page.screenshot({ path: 'output/playwright/settings-fullscreen.png' });
  const clicksBeforeSettings = await page.evaluate(() => playerClicks);
  await successToggle.click();
  check(await page.evaluate(() => playerClicks) === clicksBeforeSettings,
    'changing a setting inside the fullscreen player does not click the player');
  await page.evaluate(() => document.exitFullscreen());
  await page.waitForFunction(() => {
    const host = document.getElementById('danmaku-plus1-settings');
    return host.parentElement === document.body && host.shadowRoot.querySelector('dialog').open;
  });
  check(await settings.isVisible() && !await successToggle.isChecked(),
    'exiting fullscreen keeps settings open with the current preference');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(1300);
  await page.mouse.move(1100, 600);
  await page.evaluate(() => { engine.danmaku.core.clear(); addDm('关闭成功提示测试', 5); });
  await awaitToolbar('关闭成功提示测试');
  const sendsBeforeSettings = await page.evaluate(() => sent.length);
  await toolbar.locator('[data-action="repeat"]').click();
  await page.waitForFunction(count => sent.length === count + 1, sendsBeforeSettings);
  check(await page.evaluate(() => ![...document.body.children].some(element =>
    element.textContent === '弹幕+1成功' && element.style.opacity === '1')),
  'disabled setting suppresses success toasts immediately without stopping repeat');

  await openSettings();
  await settings.getByRole('switch', { name: '弹幕浮窗', exact: true }).uncheck();
  await page.keyboard.press('Escape');
  await page.mouse.move(1100, 600);
  await page.evaluate(() => { engine.danmaku.core.clear(); addDm('仅暂停', 5); });
  await page.waitForFunction(() => dmState('仅暂停')?.className.includes('show'));
  const pauseOnly = await state('仅暂停');
  await page.mouse.move(pauseOnly.x + pauseOnly.width / 2, pauseOnly.y + pauseOnly.height / 2);
  await page.waitForFunction(() => dmState('仅暂停')?.hover);
  check(await toolbar.isHidden(), 'disabling toolbar keeps hover pause available independently');
  await openSettings();
  await settings.getByRole('switch', { name: '鼠标悬停暂停' }).uncheck();
  await page.keyboard.press('Escape');
  await page.mouse.move(pauseOnly.x + pauseOnly.width / 2 + 1, pauseOnly.y + pauseOnly.height / 2);
  await page.waitForTimeout(100);
  check(!(await state('仅暂停'))?.hover && await toolbar.isHidden(),
    'disabling both interaction switches releases existing pause and hides toolbar');
  await openSettings();
  await settings.getByRole('switch', { name: '弹幕浮窗', exact: true }).check();
  await page.keyboard.press('Escape');
  await page.mouse.move(1100, 600);
  await page.evaluate(() => { engine.danmaku.core.clear(); addDm('仅浮窗', 5); });
  await page.waitForFunction(() => dmState('仅浮窗')?.className.includes('show'));
  const toolbarOnly = await state('仅浮窗');
  await page.mouse.move(toolbarOnly.x + toolbarOnly.width / 2, toolbarOnly.y + toolbarOnly.height / 2);
  await page.waitForFunction(() => !document.getElementById('danmaku-plus1-toolbar').hidden);
  check(!(await state('仅浮窗')).hover, 'toolbar can appear without pausing the danmaku');
  await toolbar.locator('[data-action="copy"]').click();
  check(await page.evaluate(() => copied[copied.length - 1] === '仅浮窗'),
    'toolbar actions work with hover pause disabled');
  await page.waitForFunction(() => !dmState('仅浮窗'));
  await page.waitForFunction(() => document.getElementById('danmaku-plus1-toolbar').hidden);
  check(true, 'unpaused fixed danmaku expires normally while using its toolbar');
  await openSettings();
  await settings.getByRole('switch', { name: '鼠标悬停暂停' }).check();
  await page.keyboard.press('Escape');
  check(errors.length === 0, 'no uncaught JavaScript errors');
  return { passed: results.length, results };
}
