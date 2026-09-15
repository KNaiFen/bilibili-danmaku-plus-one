async (page) => {
  const results = [];
  const errors = [];
  const check = (condition, message) => {
    if (!condition) throw new Error(message);
    results.push(message);
  };
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => route.abort());
  await page.route('http://127.0.0.1:19223/**', route => route.fulfill({
    contentType: 'text/html', body: '<html><body><div id="chat-items"></div></body></html>'
  }));
  await page.goto('http://127.0.0.1:19223/123');
  await page.evaluate(() => {
    window.scriptMenus = [];
    window.GM_registerMenuCommand = (label, command) => scriptMenus.push({ label, command });
    window.GM_getValue = (key, fallback) => {
      const raw = localStorage.getItem(key);
      return raw === null ? fallback : JSON.parse(raw);
    };
    window.GM_setValue = (key, value) => localStorage.setItem(key, JSON.stringify(value));
    window.elapsed = 0;
    const wall = Date.now();
    const monotonic = performance.now();
    Date.now = () => wall + elapsed;
    performance.now = () => monotonic + elapsed;
    document.cookie = 'bili_jct=test-only; path=/';
    document.cookie = 'DedeUserID=999; path=/';
    window.sent = [];
    window.fetch = async (url, options) => {
      sent.push({ text: options.body.get('msg'), at: elapsed });
      return { ok: true, json: async () => ({ code: 0 }) };
    };
    let serial = 0;
    window.addChat = (text, count = 1, options = {}) => {
      for (let i = 0; i < count; i++) {
        const item = document.createElement('div');
        item.className = 'chat-item danmaku-item';
        item.setAttribute('data-danmaku', text);
        item.setAttribute('data-type', options.type || '0');
        item.setAttribute('data-uid', options.uid || '12345');
        item.setAttribute('data-id_str', options.id || 'test-' + (++serial));
        item.setAttribute('data-timestamp', options.timestamp || Date.now());
        item.textContent = 'Sender: ' + text;
        document.getElementById('chat-items').appendChild(item);
      }
    };
    addChat('Loaded history', 5);
  });
  await page.addScriptTag({ path: 'bilibili-danmaku-plus-one.user.js' });
  const panel = page.locator('#danmaku-plus1-settings dialog');
  await page.evaluate(() => scriptMenus[0].command());
  const enabled = panel.getByRole('switch', { name: '自动复读', exact: true });
  const windowInput = panel.getByRole('spinbutton', { name: '统计窗口（秒）' });
  const countInput = panel.getByRole('spinbutton', { name: '触发数量（条）' });
  const intervalInput = panel.getByRole('spinbutton', { name: '最小触发间隔（秒）' });
  const flush = () => page.waitForTimeout(60);
  const emit = async (text, count = 1, options = {}) => {
    await page.evaluate(({ text, count, options }) => addChat(text, count, options), { text, count, options });
    await flush();
  };
  const advance = amount => page.evaluate(amount => { elapsed += amount; }, amount);
  const sentCount = () => page.evaluate(() => sent.length);
  const setNumber = async (input, value) => { await input.fill(String(value)); await input.blur(); };
  check(!await enabled.isChecked() && await windowInput.isDisabled(), 'automatic repeat is disabled by default');
  check(await windowInput.inputValue() === '10' && await countInput.inputValue() === '5'
    && await intervalInput.inputValue() === '5', 'defaults are a 10-second window, 5 messages and 5-second interval');
  check(await panel.getByRole('region', { name: '自动复读', exact: true }).getByRole('spinbutton').count() === 3
    && await panel.getByRole('region', { name: '弹幕交互' }).getByRole('switch').count() === 2,
  'automatic and hover settings occupy separate groups');
  await emit('Disabled', 5);
  check(await sentCount() === 0, 'disabled automatic repeat never sends');
  await enabled.check();
  check(await sentCount() === 0, 'enabling does not count existing list history');
  await emit('Exact threshold', 4);
  check(await sentCount() === 0, 'four messages do not reach the threshold');
  await emit('Exact threshold');
  check(await sentCount() === 1 && await page.evaluate(() => sent[0].text === 'Exact threshold'),
    'the fifth identical message triggers exactly one repeat');
  await emit('Another text', 5);
  await advance(4999);
  await emit('Another text');
  check(await sentCount() === 1, 'cooldown applies across different texts until the full interval elapses');
  await advance(1);
  await emit('Another text');
  check(await sentCount() === 2, 'a new qualifying message triggers at the cooldown boundary');
  await advance(5000);
  await flush();
  check(await sentCount() === 2, 'cooldown expiry alone does not resend old messages');
  await emit('Duplicate ID', 5, { id: 'same-message' });
  check(await sentCount() === 2, 'duplicate message IDs are counted once');
  await emit('Duplicate ID', 4);
  check(await sentCount() === 3, 'distinct messages with identical text count separately');
  await advance(5000);
  await emit('Own message', 5, { uid: '999' });
  await emit('Sticker', 5, { type: '1' });
  await emit('Stale history', 5, { timestamp: await page.evaluate(() => Date.now() - 20000) });
  check(await sentCount() === 3, 'own messages, non-text entries and stale history do not trigger repeat');

  await emit('Expired', 4);
  await advance(10000);
  await emit('Expired');
  check(await sentCount() === 3, 'messages at the window boundary have expired');
  await emit('Expired', 4);
  check(await sentCount() === 4, 'a fresh window can reach the threshold after old messages expire');
  await advance(5000);
  await emit('Mixed A', 3);
  await emit('Mixed B', 2);
  check(await sentCount() === 4, 'different message texts are never combined');
  await emit('Mixed A', 2);
  check(await sentCount() === 5, 'each exact text has its own sliding-window count');

  await setNumber(countInput, 2);
  await setNumber(windowInput, 1.5);
  await setNumber(intervalInput, 1);
  check(await page.evaluate(() => GM_getValue('plus1_auto_count') === 2
    && GM_getValue('plus1_auto_window') === 1.5 && GM_getValue('plus1_auto_interval') === 1),
  'all three numeric parameters are saved');
  await setNumber(countInput, 0);
  check(await countInput.inputValue() === '2' && await page.evaluate(() => GM_getValue('plus1_auto_count') === 2),
    'invalid threshold does not overwrite the saved value');
  await setNumber(countInput, 2.5);
  check(await countInput.inputValue() === '2', 'fractional message counts are rejected');
  await advance(1000);
  await emit('Configured', 2);
  check(await sentCount() === 6, 'updated threshold and cooldown take effect without reloading');
  await advance(1000);
  await emit('Short window');
  await advance(1500);
  await emit('Short window');
  check(await sentCount() === 6, 'updated window expires messages at its configured boundary');
  await emit('Short window');
  check(await sentCount() === 7, 'new messages still trigger within the shorter window');
  await enabled.uncheck();
  await advance(2000);
  await emit('While disabled', 4);
  await enabled.check();
  await emit('While disabled');
  check(await sentCount() === 7, 'reenabling starts a fresh window and skips messages received while disabled');
  await emit('While disabled');
  check(await sentCount() === 8, 'fresh messages after reenabling can trigger repeat');
  await advance(1000);
  await page.evaluate(() => {
    const old = document.getElementById('chat-items');
    old.replaceWith(old.cloneNode(true));
  });
  await flush();
  check(await sentCount() === 8, 'replacing the list does not recount existing messages');
  await emit('Replacement list', 2);
  check(await sentCount() === 9, 'new messages on a replaced list are observed');
  await advance(1000);
  await emit('Room change');
  await page.evaluate(() => history.pushState({}, '', '/456'));
  await emit('Room change');
  check(await sentCount() === 9, 'changing rooms clears the old room window');
  await emit('Room change', 2);
  check(await sentCount() === 10, 'automatic repeat resumes for the new room');

  await advance(1000);
  await page.evaluate(() => {
    window.fetch = async (url, options) => {
      sent.push({ text: options.body.get('msg'), at: elapsed });
      await new Promise(resolve => { window.finishSend = resolve; });
      return { ok: false, status: 429 };
    };
  });
  await emit('Slow request', 2);
  await advance(1000);
  await emit('Overlapping request', 2);
  check(await sentCount() === 11, 'a pending send prevents overlapping automatic requests');
  await page.evaluate(() => finishSend());
  await flush();
  check(await page.evaluate(() => document.body.textContent.includes('弹幕发送失败')),
    'failed sends report failure without automatic retry');
  await page.evaluate(() => {
    window.fetch = async (url, options) => {
      sent.push({ text: options.body.get('msg'), at: elapsed });
      return { ok: true, json: async () => ({ code: 0 }) };
    };
  });
  await setNumber(intervalInput, 5);
  await advance(5000);
  await emit('Automatic before manual', 2);
  check(await sentCount() === 12, 'automatic repeat starts a fresh cooldown');
  await advance(400);
  await page.keyboard.press('Escape');
  await page.evaluate(() => {
    const menu = document.createElement('ul');
    menu.id = 'manual-repeat-test';
    menu.innerHTML = '<li data-auto-remove="1"><span>Manual during cooldown</span><ul><li>复制弹幕</li></ul></li>';
    document.body.appendChild(menu);
  });
  await page.waitForFunction(() => !!document.querySelector('#manual-repeat-test [data-plus1-injected]'));
  await page.locator('#manual-repeat-test [data-plus1-injected]').click();
  check(await sentCount() === 13 && await page.evaluate(() => sent.at(-1).text === 'Manual during cooldown'),
    'manual repeat still sends during the automatic five-second cooldown');
  await page.evaluate(() => scriptMenus[0].command());
  await enabled.uncheck();
  check(errors.length === 0, 'automatic-repeat checks have no uncaught page errors');
  return { passed: results.length, results };
}
