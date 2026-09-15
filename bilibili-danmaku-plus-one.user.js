// ==UserScript==
// @name         Bilibili直播弹幕+1复读按钮
// @namespace    https://greasyfork.org/
// @version      1.4.1
// @description  悬停暂停单条直播弹幕并显示回复、复制、复读浮窗；回复复用B站原生@TA
// @author       You
// @match        https://live.bilibili.com/*
// @run-at       document-start
// @grant        GM_registerMenuCommand
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_setClipboard
// @grant        unsafeWindow
// @license      MIT
// @downloadURL https://update.greasyfork.org/scripts/568461/Bilibili%E7%9B%B4%E6%92%AD%E5%BC%B9%E5%B9%95%2B1%E5%A4%8D%E8%AF%BB%E6%8C%89%E9%92%AE.user.js
// @updateURL https://update.greasyfork.org/scripts/568461/Bilibili%E7%9B%B4%E6%92%AD%E5%BC%B9%E5%B9%95%2B1%E5%A4%8D%E8%AF%BB%E6%8C%89%E9%92%AE.meta.js
// ==/UserScript==

(function () {
  'use strict';

  const FALLBACK_WBI_IMG_KEY = 'c458435a75b1419ca98ab6d88b4c60d4';
  const FALLBACK_WBI_SUB_KEY = '446140f6859f439e9dd83f7ef858d1cd';
  const MIXIN_KEY_ENC_TAB = [
    46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35,
    27, 43, 5, 49, 33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13,
    37, 48, 7, 16, 24, 55, 40, 61, 26, 17, 0, 1, 60, 51, 30, 4,
    22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11, 36, 20, 34, 44, 52
  ];

  const HOOKED_ATTR = 'data-plus1-hooked';
  const INJECTED_ATTR = 'data-plus1-injected';
  const TOAST_TOGGLE_KEY = 'plus1_toast_enabled';
  const PLUS_LABEL = '+1 弹幕复读';
  const hookedItems = new WeakSet();

  let lastSendAt = 0;
  let ensureQueued = false;
  let toastEnabled = true;
  let toastTimer = 0;
  let toastEl = null;

  initMenu();
  initDanmakuHover();

  document.addEventListener('contextmenu', (event) => {
    // Menu is rendered async by player.
    setTimeout(scheduleEnsure, 0);
    setTimeout(scheduleEnsure, 30);
    setTimeout(scheduleEnsure, 120);
  }, true);

  const observer = new MutationObserver(() => {
    scheduleEnsure();
  });
  function observePage() {
    observer.observe(document.documentElement, { childList: true, subtree: true });
    scheduleEnsure();
  }
  if (document.documentElement) observePage();
  else document.addEventListener('DOMContentLoaded', observePage, { once: true });

  function scheduleEnsure() {
    if (ensureQueued) return;
    ensureQueued = true;
    requestAnimationFrame(() => {
      ensureQueued = false;
      ensurePlusOneMenuItem();
    });
  }

  function ensurePlusOneMenuItem() {
    // Player marks selected-danmaku entries with data-auto-remove, even before
    // their submenu is hovered. Never infer a selection from a normal menu item.
    const activeItems = new Set();
    for (const anchor of document.querySelectorAll('li[data-auto-remove="1"]')) {
      if (anchor.hasAttribute(INJECTED_ATTR) || anchor.parentElement?.tagName !== 'UL') continue;
      const menu = Array.from(anchor.children).find((child) => child.tagName === 'UL');
      const text = extractItemMainLabel(anchor);
      if (!menu || !text) continue;
      const template = Array.from(menu.children).find((item) =>
        item.tagName === 'LI' && !item.hasAttribute(INJECTED_ATTR)
        && extractItemMainLabel(item) === '复制弹幕');
      if (!template) continue;
      let plusItem = Array.from(menu.children).find((item) => item.hasAttribute(INJECTED_ATTR));
      if (!plusItem) {
        plusItem = template.cloneNode(true);
        plusItem.setAttribute(INJECTED_ATTR, '1');
        plusItem.removeAttribute(HOOKED_ATTR);
        plusItem.removeAttribute('id');
        plusItem.removeAttribute('onclick');
        plusItem.querySelectorAll('ul').forEach((ul) => ul.remove());
        setPrimaryLabelText(plusItem, PLUS_LABEL);
      }
      plusItem.className = template.className;
      plusItem.setAttribute('data-plus1-text', text);
      if (template.nextElementSibling !== plusItem) menu.insertBefore(plusItem, template.nextSibling);
      hookPlusItem(plusItem);
      activeItems.add(plusItem);
    }
    // Remove duplicates, obsolete selections and buttons from the old main menu.
    document.querySelectorAll('li[' + INJECTED_ATTR + ']').forEach((item) => {
      if (!activeItems.has(item)) item.remove();
    });
  }

  function hookPlusItem(itemEl) {
    if (!itemEl || hookedItems.has(itemEl)) return;
    hookedItems.add(itemEl);
    itemEl.setAttribute(HOOKED_ATTR, '1');

    itemEl.addEventListener('click', async (event) => {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      // Closing the native menu removes the selected entry synchronously.
      const text = resolveDanmakuText(itemEl);
      closeContextMenu();
      await repeatDanmaku(text);
    }, true);
  }

  async function repeatDanmaku(text) {
    if (!text) return;
    const now = Date.now();
    if (now - lastSendAt < 350) return;
    lastSendAt = now;
    try {
      await sendDanmakuDirect(text);
      console.info('[Danmaku +1] Sent:', text);
      if (toastEnabled) showToast('弹幕+1成功');
    } catch (err) {
      console.error('[Danmaku +1] Send failed:', err);
      showToast('弹幕发送失败');
    }
  }

  async function copyDanmaku(text) {
    if (typeof GM_setClipboard === 'function') {
      GM_setClipboard(text, 'text');
    } else {
      await navigator.clipboard.writeText(text);
    }
  }

  function getReplyInfo(data) {
    const modeInfo = data.modeInfo || {};
    let extra = modeInfo._extra;
    if (!extra || typeof extra !== 'object') {
      try { extra = JSON.parse(modeInfo.extra || '{}'); } catch (_) { extra = {}; }
    }
    const uid = Number(data.uid);
    const username = String(data.uname || '').trim();
    if (!/^[1-9]\d*$/.test(String(data.uid || '')) || !Number.isSafeInteger(uid) || !username) {
      return { reason: '未获取到发送者信息' };
    }
    const isMystery = !!modeInfo.user?.base?.is_mystery;
    if (isMystery) return { reason: '该发送者暂不支持回复' };
    if (extra?.show_reply !== true && extra?.show_reply !== 1) {
      return { reason: '该弹幕暂不支持回复' };
    }
    return { info: { uid, username, content: String(data.text || ''),
      ts: data.checkInfo?.ts || 0, sign: data.checkInfo?.ct || '',
      dmType: data.dmType || 0, fileId: '', imgUrl: '',
      idStr: String(data.id_str || data.dmid || ''), showReply: true, isMystery,
      isUniLiveDanmaku: !!extra?.is_mirror,
      originAnchorName: extra?.origin_anchor_name || '',
      originRoomInfo: extra?.origin_room_info || '' } };
  }

  function findNativeReplyMenu() {
    const pageWindow = typeof unsafeWindow === 'undefined' ? window : unsafeWindow;
    const seen = new Set();
    for (const element of pageWindow.document.querySelectorAll('.danmaku-menu, #danmaku-menu-vm')) {
      for (let vm = element.__vue__; vm && !seen.has(vm); vm = vm.$parent) {
        seen.add(vm);
        if (!vm._isDestroyed && vm.danmakuMenuInfo && typeof vm.showMenu === 'function'
          && typeof vm.hideMenu === 'function') return vm;
      }
    }
    return null;
  }

  async function replyDanmaku(info, point) {
    const menu = findNativeReplyMenu();
    if (!menu) {
      showToast('未找到B站回复菜单，请刷新直播间后重试');
      return;
    }
    const matches = (value) => value && String(value.uid) === String(info.uid)
      && value.username === info.username && value.content === info.content
      && String(value.idStr || '') === info.idStr;
    let openError = null;
    try {
      // This is the same controller used by the chat list. Its component owns
      // @TA, login checks and reply state; never replace it with plain @ text.
      Promise.resolve(menu.showMenu(point.x, point.y, info)).catch(error => { openError = error; });
      const deadline = performance.now() + 2500;
      while (performance.now() < deadline) {
        await new Promise(resolve => setTimeout(resolve, 40));
        if (openError) throw openError;
        if (!menu.show || !matches(menu.danmakuMenuInfo)) return;
        const component = menu.$children?.find(child =>
          !child._isDestroyed && child.$el?.matches?.('.danmaku-menu') && matches(child.info));
        // Wait for Vue to render this selection, so a stale @TA cannot reply to
        // the previous user while the component is loading or updating.
        const action = component?.$el.querySelector('.at-this-guy');
        if (!action?.getClientRects().length || getComputedStyle(action).visibility !== 'visible') continue;
        const button = action.querySelector('a, button') || action;
        if (button.disabled || button.getAttribute('aria-disabled') === 'true') break;
        button.click();
        return;
      }
      showToast('B站未提供该弹幕的@TA操作');
    } catch (error) {
      console.error('[Danmaku +1] Reply failed:', error);
      showToast('回复失败，请重试');
    } finally {
      if (menu.show && matches(menu.danmakuMenuInfo)) menu.hideMenu();
    }
  }

  function closeContextMenu() {
    // Do not mutate menu DOM directly; let page logic close it to avoid stuck state.
    const clickTarget = document.body || document.documentElement;
    clickTarget.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    clickTarget.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  }

  function resolveDanmakuText(itemEl) {
    const menu = itemEl?.parentElement;
    const anchor = menu?.parentElement;
    return menu?.tagName === 'UL' && anchor?.matches('li[data-auto-remove="1"]')
      && anchor.parentElement?.tagName === 'UL' ? extractItemMainLabel(anchor) : '';
  }

  function setPrimaryLabelText(itemEl, text) {
    const directTextNode = Array.from(itemEl.childNodes || []).find(
      (n) => n && n.nodeType === Node.TEXT_NODE && normalizeText(n.nodeValue || '')
    );
    if (directTextNode) {
      directTextNode.nodeValue = text;
      return;
    }
    const span = itemEl.querySelector('span');
    if (span) {
      span.textContent = text;
      return;
    }
    itemEl.textContent = text;
  }

  function extractItemMainLabel(itemEl) {
    if (!itemEl) return '';
    const clone = itemEl.cloneNode(true);
    clone.querySelectorAll('ul').forEach((ul) => ul.remove());
    return normalizeText(clone.textContent || '');
  }

  function normalizeText(text) {
    return String(text || '').replace(/\s+/g, ' ').trim();
  }

  function initDanmakuHover() {
    const pageWindow = typeof unsafeWindow === 'undefined' ? window : unsafeWindow;
    const engines = new Set();
    const patched = new WeakSet();
    let pointer = null;
    let held = null;
    let contextMenu = null;
    let frame = 0;
    let lastCheck = 0;
    let toolbar = null;
    let toolbarLayer = null;
    let toolbarBridge = null;
    let toolbarOwner = null;
    let toolbarStyle = null;
    let replying = false;

    function ensureToolbar(engine) {
      if (!toolbar) {
        toolbarStyle = document.createElement('style');
        toolbarStyle.textContent = `
          #danmaku-plus1-layer { position:absolute; inset:0; pointer-events:none; z-index:2147483646; }
          #danmaku-plus1-toolbar { position:absolute; box-sizing:border-box; display:grid;
            grid-template-columns:1fr 1fr 1.2fr; gap:1px; padding:2px; height:30px;
            border:1px solid rgba(255,255,255,.16); border-radius:6px;
            background:rgba(38,39,42,.65); box-shadow:0 2px 5px rgba(0,0,0,.14);
            color:#f1f1f1; pointer-events:auto; font:13px/1.2 Arial,"Microsoft YaHei",sans-serif;
            letter-spacing:0; text-shadow:none; user-select:none; }
          #danmaku-plus1-toolbar[hidden] { display:none; }
          #danmaku-plus1-toolbar button { appearance:none; box-sizing:border-box; margin:0;
            padding:0 3px; min-width:0; border:0; border-radius:4px; background:transparent;
            color:inherit; font:inherit; letter-spacing:0; white-space:nowrap; cursor:pointer; }
          #danmaku-plus1-toolbar button:hover:not(:disabled) { background:rgba(255,255,255,.12); }
          #danmaku-plus1-toolbar button:active:not(:disabled) { background:rgba(255,255,255,.2); }
          #danmaku-plus1-toolbar button:focus-visible { outline:1px solid #fff; outline-offset:-1px; }
          #danmaku-plus1-toolbar button:disabled { color:rgba(255,255,255,.36); cursor:default; }
        `;
        document.documentElement.appendChild(toolbarStyle);
        toolbarLayer = document.createElement('div');
        toolbarLayer.id = 'danmaku-plus1-layer';
        toolbar = document.createElement('div');
        toolbar.id = 'danmaku-plus1-toolbar';
        toolbar.setAttribute('role', 'toolbar');
        toolbar.setAttribute('aria-label', '弹幕操作');
        toolbar.hidden = true;
        for (const [action, label] of [['reply', '回复'], ['copy', '复制'], ['repeat', '复读+1']]) {
          const button = document.createElement('button');
          button.type = 'button';
          button.dataset.action = action;
          button.textContent = label;
          button.title = label;
          toolbar.appendChild(button);
        }
        toolbarLayer.appendChild(toolbar);
        for (const type of ['pointerdown', 'mousedown', 'dblclick', 'contextmenu']) {
          toolbar.addEventListener(type, (event) => {
            event.stopPropagation();
            if (type === 'contextmenu') event.preventDefault();
          });
        }
        toolbar.addEventListener('click', async (event) => {
          event.preventDefault();
          event.stopPropagation();
          const button = event.target.closest('button');
          const owner = held;
          if (!button || !owner || button.disabled) return;
          if (button.dataset.action === 'reply') {
            if (replying || !owner.reply.info) return;
            const rect = toolbar.getBoundingClientRect();
            replying = true;
            release();
            try {
              await replyDanmaku(owner.reply.info, { x: rect.left, y: rect.top });
            } finally {
              replying = false;
            }
            return;
          }
          const text = String(owner.dm.textData.text || '').trim();
          if (!text) return;
          button.disabled = true;
          try {
            if (button.dataset.action === 'copy') {
              await copyDanmaku(text);
              if (held === owner) button.textContent = '已复制';
            } else {
              await repeatDanmaku(text);
            }
          } catch (error) {
            console.error('[Danmaku +1] Copy failed:', error);
            showToast('复制失败');
          } finally {
            button.disabled = false;
          }
        });
      }
      const player = engine.layerWrap?.parentElement || engine.config.container.parentElement;
      if (toolbarLayer.parentElement !== player) player.appendChild(toolbarLayer);
      if (toolbarOwner !== held) {
        toolbarOwner = held;
        toolbar.querySelector('[data-action="copy"]').textContent = '复制';
        const reply = toolbar.querySelector('[data-action="reply"]');
        reply.disabled = !held.reply.info;
        reply.title = held.reply.reason || `回复 @${held.reply.info.username}`;
      }
    }

    function positionToolbar(engine) {
      ensureToolbar(engine);
      const root = toolbarLayer.getBoundingClientRect();
      const area = engine.config.container.getBoundingClientRect();
      const dm = held.element.getBoundingClientRect();
      const scaleX = root.width / toolbarLayer.offsetWidth || 1;
      const scaleY = root.height / toolbarLayer.offsetHeight || 1;
      const left = Math.max(root.left, area.left, 0) + 6;
      const right = Math.min(root.right, area.right, window.innerWidth) - 6;
      const top = Math.max(root.top, area.top, 0) + 6;
      const bottom = Math.min(root.bottom, area.bottom, window.innerHeight) - 6;
      const width = Math.min(160 * scaleX, right - left);
      const height = 30 * scaleY;
      if (width < 154 * scaleX || bottom - top < height) {
        toolbar.hidden = true;
        toolbarBridge = null;
        return;
      }
      const x = Math.max(left, Math.min(held.anchorX - width / 2, right - width));
      const below = dm.bottom + 6;
      const above = dm.top - 6 - height;
      const y = Math.max(top, Math.min(below + height <= bottom ? below : above, bottom - height));
      toolbar.style.width = `${width / scaleX}px`;
      toolbar.style.left = `${(x - root.left) / scaleX}px`;
      toolbar.style.top = `${(y - root.top) / scaleY}px`;
      toolbar.dataset.placement = y >= dm.bottom ? 'bottom' : 'top';
      toolbar.hidden = false;
      toolbarBridge = { left: x, right: x + width,
        top: Math.min(dm.bottom, y + height), bottom: Math.max(dm.top, y) };
    }

    function overToolbar() {
      if (!toolbar || toolbar.hidden || !pointer) return false;
      if (toolbar.contains(document.elementFromPoint(pointer.x, pointer.y))) return true;
      return toolbarBridge && pointer.x >= toolbarBridge.left && pointer.x <= toolbarBridge.right
        && pointer.y >= toolbarBridge.top && pointer.y <= toolbarBridge.bottom;
    }

    // LiveDanmakuEngine is loaded asynchronously. Hook before the player calls
    // onSelect so we can reach the existing engine without creating another one.
    function connectEngine() {
      const prototype = pageWindow.LiveDanmakuEngine?.default?.prototype;
      if (!prototype || patched.has(prototype) || typeof prototype.onSelect !== 'function') return;
      patched.add(prototype);
      for (const name of ['onSelect', 'set', 'resize']) {
        const original = prototype[name];
        if (typeof original !== 'function') continue;
        prototype[name] = function (...args) {
          if (this.config?.container && this.danmaku) engines.add(this);
          return Reflect.apply(original, this, args);
        };
      }
    }
    connectEngine();
    document.addEventListener('load', connectEngine, true);
    const connectTimer = window.setInterval(connectEngine, 1000);

    function managerOf(engine) {
      return engine.danmaku?.core?.manager || engine.danmaku?.magic?.core?.manager;
    }

    function containsPoint(element) {
      if (!element?.isConnected || !pointer) return false;
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0
        && pointer.x >= rect.left && pointer.x < rect.right
        && pointer.y >= rect.top && pointer.y < rect.bottom;
    }

    function isOverPlayer(engine) {
      const container = engine.config.container;
      if (!containsPoint(container)) return false;
      const target = document.elementFromPoint(pointer.x, pointer.y);
      const player = engine.layerWrap?.parentElement || container.parentElement;
      // Danmaku layers use pointer-events:none; hit-test the player underneath.
      return !!target && !!player?.contains(target)
        && !target.closest('ul, button, input, textarea, [role="dialog"]');
    }

    function release() {
      contextMenu = null;
      if (toolbar) toolbar.hidden = true;
      toolbarBridge = null;
      if (!held) return;
      const state = held;
      held = null;
      const dm = state.dm;
      if (dm.shouldDestroy === state.preventExpiry) {
        if (state.ownShouldDestroy) Object.defineProperty(dm, 'shouldDestroy', state.ownShouldDestroy);
        else delete dm.shouldDestroy;
      }
      // A cleared/recycled node must not be modified on behalf of its old owner.
      if (!state.manager.visualArray.includes(dm) || dm.element !== state.element) return;
      const elapsed = Math.max(0, state.manager.renderTime - state.startedAt);
      dm.mouseLeave();
      // Native mouseLeave counts wall time. Use engine time so buffering or a
      // paused video does not grant an extra lifetime after leaving the text.
      for (const [key, value] of state.times) dm[key] = value + elapsed;
    }

    function hold(dm, manager) {
      if (dm.isHover || !Number.isFinite(manager.renderTime)) return;
      const element = dm.element;
      // Reading x updates the engine's hit-test position before isHover freezes it.
      void dm.x;
      const times = ['middle', 'endTime', '_reverseMiddle']
        .filter((key) => Number.isFinite(dm[key])).map((key) => [key, dm[key]]);
      const ownShouldDestroy = Object.getOwnPropertyDescriptor(dm, 'shouldDestroy');
      const preventExpiry = () => false;
      dm.mouseEnter();
      dm.shouldDestroy = preventExpiry;
      held = { dm, manager, element, times, ownShouldDestroy, preventExpiry,
        startedAt: manager.renderTime, anchorX: pointer.x, leaveAt: 0,
        reply: getReplyInfo(dm.textData) };
    }

    function keepForContextMenu(engine) {
      if (!contextMenu) return false;
      const isOpen = (menu) => {
        if (!menu.isConnected || !menu.getClientRects().length) return false;
        const style = getComputedStyle(menu);
        return style.display !== 'none' && style.visibility === 'visible' && Number(style.opacity) > 0;
      };
      if (!contextMenu.menu) {
        // The player's contextmenu handler creates selection entries after ours.
        const player = engine.layerWrap?.parentElement || engine.config.container.parentElement;
        const entries = player?.querySelectorAll('li[data-auto-remove="1"]') || [];
        for (const entry of entries) {
          const menu = entry.parentElement;
          if (menu?.tagName === 'UL' && isOpen(menu)
            && extractItemMainLabel(entry) === normalizeText(held.dm.textData.text)) {
            contextMenu.menu = menu;
            contextMenu.entry = entry;
            break;
          }
        }
        if (!contextMenu.menu) {
          if (performance.now() < contextMenu.deadline) return true;
          contextMenu = null;
          return false;
        }
      }
      if (isOpen(contextMenu.menu) && contextMenu.entry.parentElement === contextMenu.menu) return true;
      contextMenu = null;
      return false;
    }

    function checkHover() {
      if (replying) return;
      if (held) {
        const engine = Array.from(engines).find((entry) => managerOf(entry) === held.manager);
        if (engine && held.manager.visualArray.includes(held.dm)
          && held.dm.element === held.element && held.element.isConnected) {
          if (keepForContextMenu(engine)) {
            if (toolbar) toolbar.hidden = true;
            toolbarBridge = null;
            held.leaveAt = 0;
            return;
          }
          positionToolbar(engine);
          if (overToolbar() || (containsPoint(held.element) && isOverPlayer(engine))) {
            held.leaveAt = 0;
            return;
          }
          // Allow a short diagonal movement from the text to the bounded toolbar.
          if (!held.leaveAt) held.leaveAt = performance.now() + 180;
          if (performance.now() < held.leaveAt) return;
        }
        release();
      }
      for (const engine of engines) {
        if (!engine.config.container.isConnected || engine.danmaku.destroyed) {
          engines.delete(engine);
          continue;
        }
        if (!isOverPlayer(engine)) continue;
        const manager = managerOf(engine);
        if (!manager?.visualArray) continue;
        for (let i = manager.visualArray.length - 1; i >= 0; i -= 1) {
          const dm = manager.visualArray[i];
          const mode = dm.textData?.rawMode || dm.textData?.mode;
          if (![1, 4, 5, 6].includes(mode) || !dm.showed || dm.isHide
            || typeof dm.mouseEnter !== 'function' || typeof dm.mouseLeave !== 'function'
            || typeof dm.shouldDestroy !== 'function' || dm.shouldDestroy()
            || !dm.element?.matches('.bili-danmaku-x-dm.bili-danmaku-x-show')
            || !containsPoint(dm.element)) continue;
          const style = getComputedStyle(dm.element);
          if (style.visibility !== 'visible' || Number(style.opacity) === 0) continue;
          hold(dm, manager);
          if (held) positionToolbar(engine);
          return;
        }
      }
    }

    function tick(now) {
      frame = 0;
      if (!pointer) return;
      // Also catch moving text passing underneath a stationary mouse.
      if (now - lastCheck >= 32) {
        lastCheck = now;
        checkHover();
      }
      frame = requestAnimationFrame(tick);
    }

    function reset() {
      pointer = null;
      cancelAnimationFrame(frame);
      frame = 0;
      release();
    }
    document.addEventListener('pointermove', (event) => {
      if (event.pointerType === 'touch') return;
      pointer = { x: event.clientX, y: event.clientY };
      if (!frame) frame = requestAnimationFrame(tick);
    }, { capture: true, passive: true });
    document.addEventListener('pointerout', (event) => {
      if (!event.relatedTarget) reset();
    }, true);
    document.addEventListener('contextmenu', (event) => {
      if (toolbar?.contains(event.target)) return;
      contextMenu = null;
      pointer = { x: event.clientX, y: event.clientY };
      checkHover();
      if (held) contextMenu = { menu: null, entry: null, deadline: performance.now() + 500 };
      if (!frame) frame = requestAnimationFrame(tick);
    }, true);
    document.addEventListener('visibilitychange', () => { if (document.hidden) reset(); });
    window.addEventListener('blur', reset);
    window.addEventListener('pagehide', () => {
      reset();
      clearInterval(connectTimer);
    });
  }

  function initMenu() {
    toastEnabled = getStoredBool(TOAST_TOGGLE_KEY, true);
    const label = toastEnabled
      ? '[Danmaku +1] 关闭成功提示'
      : '[Danmaku +1] 开启成功提示';
    registerMenuCommandSafe(label, () => {
      toastEnabled = !toastEnabled;
      setStoredBool(TOAST_TOGGLE_KEY, toastEnabled);
      const msg = toastEnabled ? '已开启：弹幕+1成功提示' : '已关闭：弹幕+1成功提示';
      console.info(`[Danmaku +1] ${msg}`);
      showToast(msg);
    });
  }

  function registerMenuCommandSafe(label, cb) {
    try {
      if (typeof GM_registerMenuCommand === 'function') {
        GM_registerMenuCommand(label, cb);
      }
    } catch (_) {}
  }

  function getStoredBool(key, fallback) {
    try {
      if (typeof GM_getValue === 'function') {
        return Boolean(GM_getValue(key, fallback));
      }
    } catch (_) {}
    try {
      const raw = localStorage.getItem(`danmaku_plus1_${key}`);
      if (raw == null) return fallback;
      return raw === '1';
    } catch (_) {
      return fallback;
    }
  }

  function setStoredBool(key, value) {
    try {
      if (typeof GM_setValue === 'function') {
        GM_setValue(key, Boolean(value));
        return;
      }
    } catch (_) {}
    try {
      localStorage.setItem(`danmaku_plus1_${key}`, value ? '1' : '0');
    } catch (_) {}
  }

  function showToast(text) {
    if (!toastEl) {
      toastEl = document.createElement('div');
      toastEl.style.position = 'fixed';
      toastEl.style.left = '50%';
      toastEl.style.top = '14%';
      toastEl.style.transform = 'translateX(-50%)';
      toastEl.style.zIndex = '2147483647';
      toastEl.style.padding = '8px 14px';
      toastEl.style.borderRadius = '8px';
      toastEl.style.background = 'rgba(0,0,0,0.75)';
      toastEl.style.color = '#fff';
      toastEl.style.fontSize = '13px';
      toastEl.style.lineHeight = '1';
      toastEl.style.opacity = '0';
      toastEl.style.transition = 'opacity 160ms ease';
      toastEl.style.pointerEvents = 'none';
      document.body.appendChild(toastEl);
    }

    toastEl.textContent = text;
    toastEl.style.opacity = '1';
    if (toastTimer) {
      clearTimeout(toastTimer);
    }
    toastTimer = window.setTimeout(() => {
      if (!toastEl) return;
      toastEl.style.opacity = '0';
    }, 1200);
  }

  async function sendDanmakuDirect(msg) {
    const csrf = getCookie('bili_jct');
    if (!csrf) {
      throw new Error('Missing bili_jct cookie. Please login first.');
    }

    const roomId = getRoomId();
    if (!roomId) {
      throw new Error('Cannot resolve room id from URL.');
    }

    const query = buildSignedQueryParams();
    const url = new URL('https://api.live.bilibili.com/msg/send');
    for (const [k, v] of Object.entries(query)) {
      url.searchParams.set(k, String(v));
    }

    const form = new FormData();
    const payload = {
      bubble: 0,
      msg,
      color: 16777215,
      mode: 1,
      fontsize: 25,
      rnd: Math.floor(Date.now() / 1000),
      roomid: Number(roomId),
      csrf,
      csrf_token: csrf
    };

    for (const [k, v] of Object.entries(payload)) {
      form.append(k, String(v));
    }

    const res = await fetch(url.toString(), {
      method: 'POST',
      credentials: 'include',
      body: form
    });

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }

    const data = await res.json();
    if (!data || data.code !== 0) {
      throw new Error(data && data.message ? data.message : 'Unknown send error');
    }

    return data;
  }

  function buildSignedQueryParams() {
    const params = {
      web_location: getWebLocation()
    };

    const webId = window._render_data_ && window._render_data_.access_id
      ? String(window._render_data_.access_id)
      : '';
    if (webId) {
      params.w_webid = webId;
    }

    const { imgKey, subKey } = getWbiKeys();
    const mixinKey = getMixinKey(imgKey + subKey);
    const wts = Math.round(Date.now() / 1000);

    const signParams = Object.assign({}, params, { wts });
    const keys = Object.keys(signParams).sort();
    const sanitize = /[!'()*]/g;

    const query = keys
      .map((key) => {
        let val = signParams[key];
        if (typeof val === 'string') {
          val = val.replace(sanitize, '');
        }
        return `${encodeURIComponent(key)}=${encodeURIComponent(String(val))}`;
      })
      .join('&');

    const wRid = md5(query + mixinKey);
    return Object.assign({}, params, {
      w_rid: wRid,
      wts: String(wts)
    });
  }

  function getWbiKeys() {
    const fromLocalStorage = parseWbiImgUrls();
    if (fromLocalStorage) return fromLocalStorage;
    return {
      imgKey: FALLBACK_WBI_IMG_KEY,
      subKey: FALLBACK_WBI_SUB_KEY
    };
  }

  function parseWbiImgUrls() {
    let raw = null;
    try {
      raw = localStorage.getItem('wbi_img_urls');
    } catch (_) {
      raw = null;
    }

    if (!raw || raw.indexOf('-') < 0) return null;

    const parts = raw.split('-');
    if (parts.length !== 2) return null;

    const imgKey = extractFileKey(parts[0]);
    const subKey = extractFileKey(parts[1]);

    if (!imgKey || !subKey) return null;
    return { imgKey, subKey };
  }

  function extractFileKey(url) {
    const last = url.slice(url.lastIndexOf('/') + 1);
    const key = last.split('.')[0] || '';
    return key;
  }

  function getMixinKey(raw) {
    const out = [];
    for (const idx of MIXIN_KEY_ENC_TAB) {
      if (raw.charAt(idx)) out.push(raw.charAt(idx));
    }
    return out.join('').slice(0, 32);
  }

  function getWebLocation() {
    const meta = document.querySelector('meta[name="spm_prefix"]');
    return (meta && meta.content) ? meta.content : '0.0';
  }

  function getRoomId() {
    const m = location.pathname.match(/\/(\d+)/);
    return m ? m[1] : '';
  }

  function getCookie(name) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const m = document.cookie.match(new RegExp(`(?:^|; )${escaped}=([^;]*)`));
    return m ? decodeURIComponent(m[1]) : '';
  }

  // MD5 (small JS implementation).
  function md5(str) {
    function cmn(q, a, b, x, s, t) {
      a = add32(add32(a, q), add32(x, t));
      return add32((a << s) | (a >>> (32 - s)), b);
    }
    function ff(a, b, c, d, x, s, t) {
      return cmn((b & c) | ((~b) & d), a, b, x, s, t);
    }
    function gg(a, b, c, d, x, s, t) {
      return cmn((b & d) | (c & (~d)), a, b, x, s, t);
    }
    function hh(a, b, c, d, x, s, t) {
      return cmn(b ^ c ^ d, a, b, x, s, t);
    }
    function ii(a, b, c, d, x, s, t) {
      return cmn(c ^ (b | (~d)), a, b, x, s, t);
    }
    function md5cycle(x, k) {
      let a = x[0];
      let b = x[1];
      let c = x[2];
      let d = x[3];

      a = ff(a, b, c, d, k[0], 7, -680876936);
      d = ff(d, a, b, c, k[1], 12, -389564586);
      c = ff(c, d, a, b, k[2], 17, 606105819);
      b = ff(b, c, d, a, k[3], 22, -1044525330);
      a = ff(a, b, c, d, k[4], 7, -176418897);
      d = ff(d, a, b, c, k[5], 12, 1200080426);
      c = ff(c, d, a, b, k[6], 17, -1473231341);
      b = ff(b, c, d, a, k[7], 22, -45705983);
      a = ff(a, b, c, d, k[8], 7, 1770035416);
      d = ff(d, a, b, c, k[9], 12, -1958414417);
      c = ff(c, d, a, b, k[10], 17, -42063);
      b = ff(b, c, d, a, k[11], 22, -1990404162);
      a = ff(a, b, c, d, k[12], 7, 1804603682);
      d = ff(d, a, b, c, k[13], 12, -40341101);
      c = ff(c, d, a, b, k[14], 17, -1502002290);
      b = ff(b, c, d, a, k[15], 22, 1236535329);

      a = gg(a, b, c, d, k[1], 5, -165796510);
      d = gg(d, a, b, c, k[6], 9, -1069501632);
      c = gg(c, d, a, b, k[11], 14, 643717713);
      b = gg(b, c, d, a, k[0], 20, -373897302);
      a = gg(a, b, c, d, k[5], 5, -701558691);
      d = gg(d, a, b, c, k[10], 9, 38016083);
      c = gg(c, d, a, b, k[15], 14, -660478335);
      b = gg(b, c, d, a, k[4], 20, -405537848);
      a = gg(a, b, c, d, k[9], 5, 568446438);
      d = gg(d, a, b, c, k[14], 9, -1019803690);
      c = gg(c, d, a, b, k[3], 14, -187363961);
      b = gg(b, c, d, a, k[8], 20, 1163531501);
      a = gg(a, b, c, d, k[13], 5, -1444681467);
      d = gg(d, a, b, c, k[2], 9, -51403784);
      c = gg(c, d, a, b, k[7], 14, 1735328473);
      b = gg(b, c, d, a, k[12], 20, -1926607734);

      a = hh(a, b, c, d, k[5], 4, -378558);
      d = hh(d, a, b, c, k[8], 11, -2022574463);
      c = hh(c, d, a, b, k[11], 16, 1839030562);
      b = hh(b, c, d, a, k[14], 23, -35309556);
      a = hh(a, b, c, d, k[1], 4, -1530992060);
      d = hh(d, a, b, c, k[4], 11, 1272893353);
      c = hh(c, d, a, b, k[7], 16, -155497632);
      b = hh(b, c, d, a, k[10], 23, -1094730640);
      a = hh(a, b, c, d, k[13], 4, 681279174);
      d = hh(d, a, b, c, k[0], 11, -358537222);
      c = hh(c, d, a, b, k[3], 16, -722521979);
      b = hh(b, c, d, a, k[6], 23, 76029189);
      a = hh(a, b, c, d, k[9], 4, -640364487);
      d = hh(d, a, b, c, k[12], 11, -421815835);
      c = hh(c, d, a, b, k[15], 16, 530742520);
      b = hh(b, c, d, a, k[2], 23, -995338651);

      a = ii(a, b, c, d, k[0], 6, -198630844);
      d = ii(d, a, b, c, k[7], 10, 1126891415);
      c = ii(c, d, a, b, k[14], 15, -1416354905);
      b = ii(b, c, d, a, k[5], 21, -57434055);
      a = ii(a, b, c, d, k[12], 6, 1700485571);
      d = ii(d, a, b, c, k[3], 10, -1894986606);
      c = ii(c, d, a, b, k[10], 15, -1051523);
      b = ii(b, c, d, a, k[1], 21, -2054922799);
      a = ii(a, b, c, d, k[8], 6, 1873313359);
      d = ii(d, a, b, c, k[15], 10, -30611744);
      c = ii(c, d, a, b, k[6], 15, -1560198380);
      b = ii(b, c, d, a, k[13], 21, 1309151649);
      a = ii(a, b, c, d, k[4], 6, -145523070);
      d = ii(d, a, b, c, k[11], 10, -1120210379);
      c = ii(c, d, a, b, k[2], 15, 718787259);
      b = ii(b, c, d, a, k[9], 21, -343485551);

      x[0] = add32(a, x[0]);
      x[1] = add32(b, x[1]);
      x[2] = add32(c, x[2]);
      x[3] = add32(d, x[3]);
    }

    function md51(s) {
      const txt = '';
      const n = s.length;
      const state = [1732584193, -271733879, -1732584194, 271733878];
      let i;
      for (i = 64; i <= n; i += 64) {
        md5cycle(state, md5blk(s.substring(i - 64, i)));
      }
      s = s.substring(i - 64);
      const tail = new Array(16).fill(0);
      for (i = 0; i < s.length; i += 1) {
        tail[i >> 2] |= s.charCodeAt(i) << ((i % 4) << 3);
      }
      tail[i >> 2] |= 0x80 << ((i % 4) << 3);
      if (i > 55) {
        md5cycle(state, tail);
        for (i = 0; i < 16; i += 1) tail[i] = 0;
      }
      tail[14] = n * 8;
      md5cycle(state, tail);
      return state;
    }

    function md5blk(s) {
      const md5blks = [];
      for (let i = 0; i < 64; i += 4) {
        md5blks[i >> 2] = s.charCodeAt(i)
          + (s.charCodeAt(i + 1) << 8)
          + (s.charCodeAt(i + 2) << 16)
          + (s.charCodeAt(i + 3) << 24);
      }
      return md5blks;
    }

    const hexChr = '0123456789abcdef'.split('');

    function rhex(n) {
      let s = '';
      for (let j = 0; j < 4; j += 1) {
        s += hexChr[(n >> (j * 8 + 4)) & 0x0f] + hexChr[(n >> (j * 8)) & 0x0f];
      }
      return s;
    }

    function hex(x) {
      for (let i = 0; i < x.length; i += 1) {
        x[i] = rhex(x[i]);
      }
      return x.join('');
    }

    function add32(a, b) {
      return (a + b) & 0xffffffff;
    }

    return hex(md51(str));
  }
})();
