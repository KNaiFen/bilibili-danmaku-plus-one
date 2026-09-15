async (page) => {
  let passed = 0;
  const errors = [];
  const check = (condition, message) => {
    if (!condition) throw new Error(message);
    passed++;
  };
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => route.abort());
  await page.route('http://127.0.0.1:19223/**', route => route.fulfill({
    contentType: 'text/html', body: '<html><body><div id="chat-items"></div></body></html>'
  }));
  await page.goto('http://127.0.0.1:19223/123');
  await page.evaluate(() => {
    window.GM_registerMenuCommand = (_, command) => { window.openSettings = command; };
    window.GM_getValue = (key, fallback) => JSON.parse(localStorage.getItem(key) ?? JSON.stringify(fallback));
    window.GM_setValue = (key, value) => localStorage.setItem(key, JSON.stringify(value));
    window.elapsed = 0;
    const wall = Date.now();
    const monotonic = performance.now();
    Date.now = () => wall + elapsed;
    performance.now = () => monotonic + elapsed;
    document.cookie = 'bili_jct=test-only; path=/';
    document.cookie = 'DedeUserID=999; path=/';
    window.sent = [];
    window.fetch = async (_, options) => {
      sent.push(options.body.get('msg'));
      if (window.delaySend) await new Promise(resolve => { window.finishSend = resolve; });
      return { ok: true, json: async () => ({ code: 0 }) };
    };
    let serial = 0;
    window.addChat = (text, count, options) => {
      for (let i = 0; i < count; i++) {
        const item = document.createElement('div');
        item.className = 'danmaku-item';
        for (const [key, value] of Object.entries({ danmaku: text, type: '0', uid: '12345',
          id_str: 'test-' + (++serial), timestamp: Date.now(), ...options })) item.setAttribute('data-' + key, value);
        document.getElementById('chat-items').appendChild(item);
      }
    };
  });
  await page.addScriptTag({ path: 'bilibili-danmaku-plus-one.user.js' });
  await page.evaluate(() => openSettings());
  const panel = page.locator('#danmaku-plus1-settings dialog');
  const enabled = panel.getByRole('switch', { name: '自动复读', exact: true });
  const emit = async (text, count = 1, options = {}) => {
    await page.evaluate(args => addChat(...args), [text, count, options]);
    await page.waitForTimeout(50);
  };
  const advance = amount => page.evaluate(amount => { elapsed += amount; }, amount);
  const sentCount = () => page.evaluate(() => sent.length);
  const setNumber = async (name, value) => {
    const input = panel.getByRole('spinbutton', { name });
    await input.fill(String(value));
    await input.blur();
  };
  await emit('History', 5);
  check(!await enabled.isChecked() && await sentCount() === 0, 'automatic repeat defaults to off and sends nothing');
  await enabled.check();
  await emit('History');
  await emit('New', 4);
  check(await sentCount() === 0, 'enabling skips history and different texts do not share a count');
  await emit('New');
  check(await sentCount() === 1 && await page.evaluate(() => sent[0] === 'New'), 'the fifth identical message triggers once');
  await emit('Other', 5);
  await advance(4999);
  await emit('Other');
  check(await sentCount() === 1, 'cooldown blocks every text before five seconds');
  await advance(1);
  await emit('Other');
  check(await sentCount() === 2, 'new messages can trigger at the cooldown boundary');

  await advance(400);
  await page.keyboard.press('Escape');
  await page.evaluate(() => {
    const menu = document.createElement('ul');
    menu.innerHTML = '<li data-auto-remove="1"><span>Manual</span><ul><li>复制弹幕</li></ul></li>';
    document.body.appendChild(menu);
  });
  await page.locator('[data-plus1-injected]').click();
  check(await sentCount() === 3 && await page.evaluate(() => sent.at(-1) === 'Manual'), 'manual repeat bypasses the automatic cooldown');
  await page.evaluate(() => openSettings());
  await advance(10000);
  await emit('Other');
  check(await sentCount() === 3, 'old messages expire from the sliding window');
  await emit('Duplicate', 5, { id_str: 'same-id' });
  await emit('Own', 5, { uid: '999' });
  await emit('Sticker', 5, { type: '1' });
  check(await sentCount() === 3, 'duplicate IDs, own messages and non-text entries cannot cause repeats');

  await setNumber('统计窗口（秒）', 1.5);
  await setNumber('触发数量（条）', 2);
  await setNumber('最小触发间隔（秒）', 1);
  await setNumber('触发数量（条）', 0);
  check(await panel.getByRole('spinbutton', { name: '触发数量（条）' }).inputValue() === '2'
    && await page.evaluate(() => GM_getValue('plus1_auto_window') === 1.5 && GM_getValue('plus1_auto_interval') === 1),
  'numeric settings persist and invalid values preserve the last valid value');
  await emit('Configured', 2);
  check(await sentCount() === 4, 'updated threshold takes effect immediately');
  await advance(1500);
  await emit('Configured');
  check(await sentCount() === 4, 'updated window expires at its configured boundary');
  await emit('Configured');
  check(await sentCount() === 5, 'updated cooldown allows another qualifying send');
  await enabled.uncheck();
  await advance(2000);
  await emit('Disabled', 2);
  await enabled.check();
  await emit('Disabled');
  check(await sentCount() === 5, 'reenabling clears the old window and ignores messages received while disabled');

  await page.evaluate(() => {
    const list = document.getElementById('chat-items');
    list.replaceWith(list.cloneNode(true));
  });
  await page.waitForTimeout(50);
  check(await sentCount() === 5, 'list replacement does not replay history');
  await emit('Replacement', 2);
  check(await sentCount() === 6, 'replacement list still observes new messages');
  await advance(2000);
  await page.evaluate(() => { window.delaySend = true; });
  await emit('Pending', 2);
  await advance(1000);
  await emit('Overlapping', 2);
  check(await sentCount() === 7, 'pending send prevents overlapping automatic requests');
  await page.evaluate(() => finishSend());
  await enabled.uncheck();
  check(errors.length === 0, errors.join('; '));
  return { passed };
}
