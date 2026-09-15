// ==UserScript==
// @name         Bilibili直播弹幕+1复读按钮
// @namespace    https://greasyfork.org/
// @version      1.1.6
// @description  给右键菜单添加一个+1选项，当选中弹幕右键的时候点击这个+1就能复读弹幕
// @author       You
// @match        https://live.bilibili.com/*
// @run-at       document-idle
// @grant        GM_registerMenuCommand
// @grant        GM_getValue
// @grant        GM_setValue
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

  let lastDanmakuText = '';
  let lastSendAt = 0;
  let ensureQueued = false;
  let toastEnabled = true;
  let toastTimer = 0;
  let toastEl = null;

  initMenu();

  document.addEventListener('contextmenu', (event) => {
    const dm = event.target && event.target.closest
      ? event.target.closest('.bili-danmaku-x-dm')
      : null;
    if (!dm) return;
    const text = (dm.textContent || '').trim();
    if (text) lastDanmakuText = text;
    // Menu is rendered async by player.
    setTimeout(scheduleEnsure, 0);
    setTimeout(scheduleEnsure, 30);
    setTimeout(scheduleEnsure, 120);
  }, true);

  const observer = new MutationObserver(() => {
    scheduleEnsure();
  });
  observer.observe(document.documentElement || document.body, {
    childList: true,
    subtree: true
  });

  function scheduleEnsure() {
    if (ensureQueued) return;
    ensureQueued = true;
    requestAnimationFrame(() => {
      ensureQueued = false;
      ensurePlusOneMenuItem();
    });
  }

  function ensurePlusOneMenuItem() {
    const handledMenus = new Set();

    const copyItems = findVisibleTextNodes('复制弹幕');
    for (const copyTextNode of copyItems) {
      const copyItem = findMenuItemElement(copyTextNode);
      if (!copyItem) continue;

      const submenu = copyItem.parentElement;
      if (!submenu) continue;
      if (!submenu.textContent.includes('举报选中弹幕')) continue;

      // Put +1 in first-level menu: after submenu host item.
      const hostItem = submenu.closest('li');
      const mainMenu = hostItem && hostItem.parentElement && hostItem.parentElement.tagName === 'UL'
        ? hostItem.parentElement
        : submenu;
      if (!mainMenu || !isLikelyMenu(mainMenu)) continue;
      const anchorItem = hostItem || copyItem;
      const dmText = getDanmakuTextFromMenuContext(copyItem);
      const statsTemplate = findMenuItemByText(mainMenu, '视频统计信息');
      const templateItem = statsTemplate || copyItem;

      let existingPlusItem = findMenuItemByText(mainMenu, '+1 弹幕复读');
      if (existingPlusItem && existingPlusItem.parentElement !== mainMenu) {
        // Stale +1 in nested submenu: recreate with first-level style.
        existingPlusItem = null;
      }
      if (existingPlusItem) {
        // Ensure +1 uses non-submenu item style.
        if ((existingPlusItem.className || '') !== (templateItem.className || '')) {
          const replacement = templateItem.cloneNode(true);
          replacement.setAttribute(INJECTED_ATTR, '1');
          replacement.removeAttribute(HOOKED_ATTR);
          replacement.querySelectorAll('ul').forEach((ul) => ul.remove());
          setPrimaryLabelText(replacement, '+1 弹幕复读');
          if (existingPlusItem.parentElement) {
            existingPlusItem.parentElement.replaceChild(replacement, existingPlusItem);
          }
          existingPlusItem = replacement;
        }
        if (dmText) existingPlusItem.setAttribute('data-plus1-text', dmText);
        if (anchorItem && anchorItem.parentElement === mainMenu && existingPlusItem !== anchorItem.nextSibling) {
          mainMenu.insertBefore(existingPlusItem, anchorItem.nextSibling);
        }
        hookPlusItem(existingPlusItem);
      } else {
        // Clone "视频统计信息" style when possible.
        const plusItem = templateItem.cloneNode(true);
        plusItem.setAttribute(INJECTED_ATTR, '1');
        plusItem.removeAttribute(HOOKED_ATTR);
        plusItem.querySelectorAll('ul').forEach((ul) => ul.remove());
        setPrimaryLabelText(plusItem, '+1 弹幕复读');
        if (dmText) plusItem.setAttribute('data-plus1-text', dmText);
        hookPlusItem(plusItem);
        if (anchorItem && anchorItem.parentElement === mainMenu) {
          mainMenu.insertBefore(plusItem, anchorItem.nextSibling);
        } else {
          mainMenu.appendChild(plusItem);
        }
      }

      // Remove stale +1 from second-level submenu.
      const plusInSubmenu = findMenuItemByText(submenu, '+1 弹幕复读');
      if (plusInSubmenu && plusInSubmenu.parentElement === submenu) {
        plusInSubmenu.remove();
      }

      handledMenus.add(mainMenu);
    }

    // First-open fallback:
    // inject +1 from first-level menu even when secondary submenu hasn't been hovered yet.
    const statItems = findVisibleTextNodes('视频统计信息');
    for (const statTextNode of statItems) {
      const statItem = findMenuItemElement(statTextNode);
      if (!statItem) continue;
      const mainMenu = statItem.parentElement;
      if (!mainMenu || !isLikelyMenu(mainMenu)) continue;
      if (handledMenus.has(mainMenu)) continue;

      const anchorItem = findDanmakuAnchorInMainMenu(mainMenu) || statItem;
      const dmText = extractItemMainLabel(anchorItem) || (lastDanmakuText || '').trim();

      let plusItem = findMenuItemByText(mainMenu, '+1 弹幕复读');
      if (!plusItem) {
        plusItem = statItem.cloneNode(true);
        plusItem.setAttribute(INJECTED_ATTR, '1');
        plusItem.removeAttribute(HOOKED_ATTR);
        plusItem.querySelectorAll('ul').forEach((ul) => ul.remove());
        setPrimaryLabelText(plusItem, '+1 弹幕复读');
        mainMenu.insertBefore(plusItem, anchorItem.nextSibling);
      } else if (plusItem.parentElement === mainMenu && plusItem !== anchorItem.nextSibling) {
        mainMenu.insertBefore(plusItem, anchorItem.nextSibling);
      }

      if (dmText) plusItem.setAttribute('data-plus1-text', dmText);
      hookPlusItem(plusItem);
      handledMenus.add(mainMenu);
    }

    // If page JS already injects +1, take over its click behavior.
    const plusTextNodes = findVisibleTextNodes('+1 弹幕复读');
    for (const plusTextNode of plusTextNodes) {
      const plusItem = findMenuItemElement(plusTextNode);
      if (!plusItem) continue;
      const menuContainer = plusItem.parentElement;
      if (!menuContainer) continue;
      if (!menuContainer.textContent.includes('举报选中弹幕')) continue;
      hookPlusItem(plusItem);
    }
  }

  function hookPlusItem(itemEl) {
    if (!itemEl || itemEl.getAttribute(HOOKED_ATTR) === '1') return;
    itemEl.setAttribute(HOOKED_ATTR, '1');

    itemEl.addEventListener('click', async (event) => {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      closeContextMenu(itemEl);

      // Simple anti-double-click.
      const now = Date.now();
      if (now - lastSendAt < 350) return;
      lastSendAt = now;

      const text = resolveDanmakuText(itemEl);
      if (!text) {
        console.warn('[Danmaku +1] Cannot resolve danmaku text from context menu.');
        return;
      }

      try {
        await sendDanmakuDirect(text);
        console.info('[Danmaku +1] Sent:', text);
        if (toastEnabled) {
          showToast('弹幕+1成功');
        }
      } catch (err) {
        console.error('[Danmaku +1] Send failed:', err);
      }
    }, true);
  }

  function closeContextMenu(itemEl) {
    // Do not mutate menu DOM directly; let page logic close it to avoid stuck state.
    const clickTarget = document.body || document.documentElement;
    clickTarget.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    clickTarget.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  }

  function resolveDanmakuText(itemEl) {
    const boundText = normalizeText(itemEl && itemEl.getAttribute
      ? (itemEl.getAttribute('data-plus1-text') || '')
      : '');
    if (boundText) return boundText;
    // Preferred path: read text from the same context-menu root container.
    const fromMenu = getDanmakuTextFromMenuContext(itemEl);
    if (fromMenu) return fromMenu;
    // Fallback: text captured at right-click time.
    return (lastDanmakuText || '').trim();
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

  function findDanmakuAnchorInMainMenu(mainMenu) {
    const byAutoRemove = mainMenu.querySelector('li[data-auto-remove=\"1\"]');
    if (byAutoRemove) return byAutoRemove;
    const firstLi = Array.from(mainMenu.children || []).find((n) => n && n.tagName === 'LI');
    return firstLi || null;
  }

  function extractItemMainLabel(itemEl) {
    if (!itemEl) return '';
    const clone = itemEl.cloneNode(true);
    clone.querySelectorAll('ul').forEach((ul) => ul.remove());
    return normalizeText(clone.textContent || '');
  }

  function isLikelyMenu(el) {
    if (!el || el.tagName !== 'UL') return false;
    return Array.from(el.children || []).some((c) => c && c.tagName === 'LI');
  }

  function getDanmakuTextFromMenuContext(itemEl) {
    const menu = itemEl && itemEl.closest ? itemEl.closest('ul') : null;
    if (!menu) return '';
    const root = menu.parentElement;
    if (!root) return getTextFromAncestorChain(menu, menu);

    // In current player DOM, root children are usually:
    // 1) danmaku text element, 2) decoration div, 3) menu ul.
    const directText = getFirstDirectChildTextExcluding(root, menu);
    if (directText) return directText;

    // Fallback: gather descendant text excluding the menu subtree.
    const deepText = getDescendantTextExcluding(root, menu);
    if (deepText) return deepText;

    // Final fallback: climb a few levels in case menu is wrapped by extra nodes.
    return getTextFromAncestorChain(root, menu);
  }

  function getFirstDirectChildTextExcluding(root, excludedChild) {
    const children = Array.from(root.children || []);
    for (const child of children) {
      if (child === excludedChild) continue;
      const text = normalizeText(child.textContent || '');
      if (text) return text;
    }
    return '';
  }

  function getDescendantTextExcluding(root, excludedSubtree) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const parts = [];
    while (walker.nextNode()) {
      const node = walker.currentNode;
      const parent = node && node.parentElement;
      if (!parent) continue;
      if (excludedSubtree.contains(parent)) continue;
      const text = normalizeText(node.nodeValue || '');
      if (!text) continue;
      parts.push(text);
    }
    if (!parts.length) return '';
    // Prefer the longest chunk, usually the danmaku content.
    parts.sort((a, b) => b.length - a.length);
    return parts[0];
  }

  function normalizeText(text) {
    return String(text || '').replace(/\s+/g, ' ').trim();
  }

  function getTextFromAncestorChain(startEl, excludedSubtree) {
    let cur = startEl;
    for (let depth = 0; cur && depth < 5; depth += 1) {
      const text = getDescendantTextExcluding(cur, excludedSubtree);
      if (text) return text;
      cur = cur.parentElement;
    }
    return '';
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

  function findVisibleTextNodes(text) {
    const all = Array.from(document.querySelectorAll('div,li,span,p'));
    return all.filter((el) => {
      if (!isVisible(el)) return false;
      return (el.textContent || '').trim() === text;
    });
  }

  function findMenuItemByText(menuContainer, text) {
    const all = Array.from(menuContainer.querySelectorAll('div,li,span,p'));
    for (const el of all) {
      if ((el.textContent || '').trim() !== text) continue;
      const item = findMenuItemElement(el);
      if (item) return item;
    }
    return null;
  }

  function findMenuItemElement(el) {
    if (!el) return null;
    const byRole = el.closest('[role="menuitem"]');
    if (byRole) return byRole;
    const byLi = el.closest('li');
    if (byLi) return byLi;
    return el.closest('div');
  }

  function isVisible(el) {
    if (!el || !(el instanceof Element)) return false;
    return !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
  }

  function replaceFirstText(root, fromText, toText) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode;
      if (!node || !node.nodeValue) continue;
      if (node.nodeValue.trim() === fromText) {
        node.nodeValue = node.nodeValue.replace(fromText, toText);
        return;
      }
    }
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
