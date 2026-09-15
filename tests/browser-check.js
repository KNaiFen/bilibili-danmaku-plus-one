async (page) => {
  let passed = 0;
  const errors = [];
  const check = (condition, message) => {
    if (!condition) throw new Error(message);
    passed++;
  };
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    window.GM_registerMenuCommand = (_, command) => { window.openSettings = command; };
    window.GM_getValue = (key, fallback) => JSON.parse(localStorage.getItem(key) ?? JSON.stringify(fallback));
    window.GM_setValue = (key, value) => localStorage.setItem(key, JSON.stringify(value));
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
  const openSettings = () => page.evaluate(() => openSettings());
  await openSettings();
  await settings.getByRole('switch', { name: '复读成功提示' }).uncheck();
  await page.keyboard.press('Escape');
  check(!await settings.isVisible(), 'Escape closes settings');
  await page.reload();
  await page.addScriptTag({ path: 'bilibili-danmaku-plus-one.user.js' });
  await openSettings();
  check(!await settings.getByRole('switch', { name: '复读成功提示' }).isChecked(), 'settings survive reload');
  await settings.getByRole('switch', { name: '复读成功提示' }).check();
  await settings.getByRole('button', { name: '关闭设置' }).click();
  await page.addScriptTag({ url: 'http://127.0.0.1:19222/danmaku-v2.js' });
  await page.evaluate(() => {
    window.engine = new LiveDanmakuEngine.default(document.getElementById('layer'), { userId: 0, isMobile: false, rnd: 'test' });
    engine.onSelect(() => {});
    engine.danmaku.magic.init();
    document.cookie = 'bili_jct=test-only; path=/';
    window.sent = [];
    window.copied = [];
    window.playerClicks = 0;
    window.GM_setClipboard = text => copied.push(text);
    window.fetch = async (_, options) => { sent.push(options.body.get('msg')); return { ok: true, json: async () => ({ code: 0 }) }; };
    document.getElementById('player').addEventListener('click', () => playerClicks++);
  });
  await page.waitForFunction(() => !!engine.danmaku.core);
  await page.evaluate(() => {
    const core = engine.danmaku.core;
    core.setSetting('duration', 1.5);
    core.play();
    window.addDm = (id, mode) => {
      // Keep test injection out of the saved engine's split initialization stages.
      core.timeController.updateTime();
      core.manager.renderTime = core.timeController.renderTime;
      core.manager.currentTime = core.timeController.currentTime;
      core.add({ text: id, mode, dmid: id, size: 25, color: 16777215, stime: core.config.fn.timelineSync() * 1000 });
      core.manager.beforeCollisionCheck();
      core.manager.collisionCheck();
    };
    window.dmState = id => {
      const dm = core.manager.visualArray.find(item => item.textData.dmid === id);
      if (!dm) return null;
      const rect = dm.element.getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height,
        hover: !!dm.isHover, life: dm.endTime - core.manager.renderTime, shown: dm.showed };
    };
  });
  const toolbar = page.locator('#danmaku-plus1-toolbar');
  const state = id => page.evaluate(id => dmState(id), id);
  const leave = () => page.mouse.move(1100, 650);
  const hover = async id => {
    await page.waitForFunction(id => dmState(id)?.shown, id);
    const dm = await state(id);
    await page.mouse.move(Math.max(8, Math.min(dm.x + dm.width / 2, page.viewportSize().width - 8)), dm.y + dm.height / 2);
  };
  const add = async (id, mode = 5) => {
    await leave();
    await page.evaluate(({ id, mode }) => { engine.danmaku.core.clear(); addDm(id, mode); }, { id, mode });
    await hover(id);
  };
  const bounds = locator => locator.evaluate(element => {
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.left >= 0 && rect.top >= 0 && rect.right <= innerWidth && rect.bottom <= innerHeight
      && element.scrollWidth <= element.clientWidth;
  });

  await add('Fixed');
  await page.waitForFunction(() => dmState('Fixed')?.hover);
  check(await toolbar.locator('[data-action="reply"]').isDisabled(), 'reply without sender data is disabled');
  await toolbar.locator('[data-action="copy"]').click();
  await toolbar.locator('[data-action="repeat"]').click();
  await page.waitForTimeout(1700);
  check(await page.evaluate(() => copied[0] === 'Fixed' && sent[0] === 'Fixed' && playerClicks === 0)
    && (await state('Fixed'))?.life < 0, 'toolbar actions preserve the held message past expiry without clicking the player');
  await leave();
  await page.waitForFunction(() => dmState('Fixed') && !dmState('Fixed').hover);
  check((await state('Fixed')).life > 0, 'leaving restores the remaining fixed-message lifetime');
  await page.waitForFunction(() => !dmState('Fixed'));

  await leave();
  await page.evaluate(() => addDm('Rolling', 1));
  await page.waitForFunction(() => { const dm = dmState('Rolling'); return dm && dm.x + dm.width < 930; });
  await hover('Rolling');
  await page.waitForFunction(() => dmState('Rolling')?.hover);
  const rolling = await state('Rolling');
  await page.waitForTimeout(500);
  check(Math.abs((await state('Rolling')).x - rolling.x) < 1, 'hover stops rolling motion');
  await leave();
  await page.waitForFunction(x => dmState('Rolling')?.x < x - 30, rolling.x);

  // One menu flow covers delayed rendering, nearby messages and selection
  // destruction during close, the original right-click regressions.
  await page.evaluate(() => {
    const menu = document.createElement('ul');
    menu.id = 'context-menu';
    menu.style.cssText = 'position:absolute;left:20px;top:80px;background:white;display:none';
    document.getElementById('player').appendChild(menu);
    engine.onSelect(items => setTimeout(() => {
      menu.innerHTML = '';
      for (const text of [items[0].text, 'Nearby']) {
        const item = document.createElement('li');
        item.dataset.autoRemove = '1';
        item.innerHTML = '<span></span><ul><li>复制弹幕</li></ul>';
        item.querySelector('span').textContent = text;
        menu.appendChild(item);
      }
      menu.style.display = '';
    }, 30));
    document.body.addEventListener('mousedown', event => {
      if (!menu.contains(event.target)) { menu.replaceChildren(); menu.style.display = 'none'; }
    });
  });
  await add('Menu');
  await page.waitForFunction(() => dmState('Menu')?.hover);
  const selected = await state('Menu');
  await page.mouse.click(selected.x + selected.width / 2, selected.y + selected.height / 2, { button: 'right' });
  const actions = page.locator('#context-menu > li > ul > [data-plus1-injected]');
  await actions.last().waitFor();
  await actions.last().hover();
  await page.waitForTimeout(1700);
  check(await actions.count() === 2 && (await state('Menu'))?.hover && (await state('Menu')).life < 0,
    'both submenus get actions and the context menu preserves hover past expiry');
  await actions.last().click();
  check(await page.evaluate(() => sent.at(-1) === 'Nearby'), 'submenu sends its own text even when close destroys the selection');
  await page.waitForFunction(() => !dmState('Menu')?.hover);
  await page.evaluate(() => { document.getElementById('context-menu').remove(); engine.onSelect(() => {}); });

  // Model the native reply controller only; the saved engine parses the sender.
  // Delayed props detect accidental replies to a previous sender.
  await leave();
  await page.evaluate(() => {
    const element = document.createElement('div');
    element.className = 'danmaku-menu';
    element.style.display = 'none';
    element.innerHTML = '<div class="at-this-guy"><a>@TA</a></div>';
    document.body.appendChild(element);
    const child = { $el: element, info: { uid: 999, username: 'Old sender' } };
    const menu = {
      show: false, danmakuMenuInfo: {}, $children: [child],
      showMenu(x, y, info) {
        this.show = true;
        this.danmakuMenuInfo = info;
        element.style.display = '';
        setTimeout(() => { child.info = info; }, 100);
      },
      hideMenu() { this.show = false; element.style.display = 'none'; }
    };
    child.$parent = menu;
    element.__vue__ = child;
    element.querySelector('a').addEventListener('click', () => { window.replyTarget = child.info; menu.hideMenu(); });
    engine.danmaku.core.clear();
    engine.handleSocketMessage({ cmd: 'DANMU_MSG', info: [
      [0, 5, 25, 16777215, 0, 777, 0, 0, 0, 0, 0, '', 0, {}, null,
        { extra: JSON.stringify({ show_reply: true, id_str: 'reply' }), user: { base: { is_mystery: false } } }],
      'Reply text', [12345, 'Sender', 0, 0, 0, 0, 0], [], [1], [], 0, 0, 0, { ts: 123, ct: 'test-sign' }
    ] });
  });
  await hover('reply');
  await toolbar.locator('[data-action="reply"]').click();
  await page.waitForFunction(() => !!window.replyTarget);
  check(await page.evaluate(() => replyTarget.uid === 12345 && replyTarget.idStr === 'reply' && sent.length === 2),
    'reply invokes native @TA with the current sender without sending a message');

  // Combine narrow width, bottom placement and the right edge into one check.
  await leave();
  await page.setViewportSize({ width: 320, height: 568 });
  await page.evaluate(() => {
    engine.danmaku.core.clear();
    document.getElementById('player').style.cssText = 'position:relative;width:320px;height:180px;background:#333';
    engine.resize();
    addDm('Edge', 4);
  });
  await page.waitForFunction(() => dmState('Edge')?.shown);
  await page.evaluate(() => {
    const dm = engine.danmaku.core.manager.visualArray.find(dm => dm.textData.dmid === 'Edge');
    dm.element.style.setProperty('left', '290px', 'important');
  });
  await hover('Edge');
  await toolbar.locator('[data-action="copy"]').click();
  check(await bounds(toolbar) && await toolbar.getAttribute('data-placement') === 'top'
    && await page.evaluate(() => copied.at(-1) === 'Edge'), 'bottom-edge toolbar stays usable in a narrow player');
  await openSettings();
  check(await bounds(settings), 'grouped settings fit the narrow viewport');
  await settings.getByRole('switch', { name: '弹幕浮窗', exact: true }).uncheck();
  await page.keyboard.press('Escape');
  await page.setViewportSize({ width: 1280, height: 720 });
  await add('Pause only');
  await page.waitForFunction(() => dmState('Pause only')?.hover);
  check(await toolbar.isHidden(), 'hover pause works with toolbar disabled');
  await openSettings();
  await settings.getByRole('switch', { name: '鼠标悬停暂停' }).uncheck();
  await page.keyboard.press('Escape');
  await hover('Pause only');
  await page.waitForTimeout(100);
  check(!(await state('Pause only'))?.hover && await toolbar.isHidden(), 'disabling both switches releases the held message');
  await openSettings();
  await settings.getByRole('switch', { name: '弹幕浮窗', exact: true }).check();
  await page.keyboard.press('Escape');
  await add('Toolbar only');
  await toolbar.locator('[data-action="copy"]').click();
  check(!(await state('Toolbar only')).hover && await page.evaluate(() => copied.at(-1) === 'Toolbar only'),
    'toolbar works with hover pause disabled');
  await page.waitForFunction(() => !dmState('Toolbar only'));
  await toolbar.waitFor({ state: 'hidden' });

  await page.evaluate(() => document.getElementById('player').requestFullscreen());
  await openSettings();
  check(await settings.isVisible() && await bounds(settings), 'settings can open in fullscreen');
  await page.evaluate(() => document.exitFullscreen());
  await page.waitForFunction(() => document.getElementById('danmaku-plus1-settings').parentElement === document.body);
  check(await settings.isVisible(), 'settings stay open after fullscreen exit');
  await settings.getByRole('switch', { name: '复读成功提示' }).uncheck();
  await page.mouse.click(8, 8);
  check(!await settings.isVisible(), 'backdrop closes settings');
  await add('Silent repeat');
  await toolbar.locator('[data-action="repeat"]').click();
  check(await page.evaluate(() => sent.at(-1) === 'Silent repeat' && ![...document.body.children].some(element =>
    element.textContent === '弹幕+1成功' && element.style.opacity === '1')), 'success-toast switch affects sends immediately');
  check(errors.length === 0, errors.join('; '));
  return { passed };
}
