#!/usr/bin/env node
// One CDP command per invocation against the browser launch.sh started.
//
//   drive.mjs open <url>                 navigate and wait for load
//   drive.mjs login                      log in to the live proxy with $CLIPROXY_MANAGEMENT_KEY
//   drive.mjs route <hash-path>          change the hash route in place, e.g. /quota (keeps the session)
//   drive.mjs wait <target> [ms]         wait until a target is visible
//   drive.mjs click <target>             click a target
//   drive.mjs fill <target> <text>       replace an input's value as typed text
//   drive.mjs text <target>              print a target's innerText
//   drive.mjs eval <js>                  print the JSON result of a page expression
//   drive.mjs shot <file.png> [target]   screenshot the viewport, or one element
//   drive.mjs theme <dark|light|paper|auto>  pick the panel theme from the header menu
//   drive.mjs size <width> <height>      set the viewport; every later call reapplies it and waits for layout
//   drive.mjs redact                     mask emails and account ids in the page before a public screenshot
//   drive.mjs close                      close the browser
//
// A target is a CSS selector, or text=<visible text> for the smallest visible
// element whose text matches, or role=<role>:<accessible name>.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const stateDir = process.env.VERIFY_STATE_DIR ?? '/tmp/verify-clepsydra';
const session = Object.fromEntries(
  readFileSync(`${stateDir}/session.env`, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [key, ...rest] = line.split('=');
      return [key, rest.join('=').replace(/^'|'$/g, '')];
    })
);
const cdpPort = session.CDP_PORT;
const loginFailedMarker = `${stateDir}/login-failed`;

async function pageSocketUrl() {
  const targets = await (await fetch(`http://127.0.0.1:${cdpPort}/json/list`)).json();
  const page = targets.find((target) => target.type === 'page');
  if (!page) throw new Error('No page target');
  return page.webSocketDebuggerUrl.replace(/127\.0\.0\.1:\d+/, `127.0.0.1:${cdpPort}`);
}

async function browserSocketUrl() {
  const version = await (await fetch(`http://127.0.0.1:${cdpPort}/json/version`)).json();
  return version.webSocketDebuggerUrl.replace(/127\.0\.0\.1:\d+/, `127.0.0.1:${cdpPort}`);
}

function connect(url) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    let nextId = 1;
    const pending = new Map();
    socket.onmessage = (event) => {
      const message = JSON.parse(event.data);
      const waiter = pending.get(message.id);
      if (!waiter) return;
      pending.delete(message.id);
      if (message.error) waiter.reject(new Error(message.error.message));
      else waiter.resolve(message.result);
    };
    socket.onerror = () => reject(new Error(`CDP connection failed: ${url}`));
    socket.onopen = () =>
      resolve({
        send(method, params = {}) {
          const id = nextId++;
          socket.send(JSON.stringify({ id, method, params }));
          return new Promise((res, rej) => pending.set(id, { resolve: res, reject: rej }));
        },
        close: () => socket.close(),
      });
  });
}

const finderSource = `
(target) => {
  const visible = (el) => {
    const rect = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
  };
  if (target.startsWith('text=')) {
    const wanted = target.slice(5).trim();
    const matches = [...document.querySelectorAll('body *')].filter(
      (el) => visible(el) && el.innerText && el.innerText.trim() === wanted
    );
    const fuzzy = matches.length ? matches : [...document.querySelectorAll('body *')].filter(
      (el) => visible(el) && el.innerText && el.innerText.includes(wanted)
    );
    return fuzzy.sort((a, b) => a.innerText.length - b.innerText.length)[0] ?? null;
  }
  if (target.startsWith('role=')) {
    const [role, ...nameParts] = target.slice(5).split(':');
    const name = nameParts.join(':').trim();
    const implicit = { button: 'button', link: 'a', tab: '[role=tab]', checkbox: 'input[type=checkbox]', switch: '[role=switch]' };
    const candidates = document.querySelectorAll('[role="' + role + '"], ' + (implicit[role] ?? '[role="' + role + '"]'));
    return [...candidates].find((el) => {
      if (!visible(el)) return false;
      const label = el.getAttribute('aria-label') || el.innerText || el.getAttribute('title') || '';
      return !name || label.trim() === name || label.includes(name);
    }) ?? null;
  }
  const el = document.querySelector(target);
  return el && visible(el) ? el : null;
}`;

async function evaluate(page, expression) {
  const result = await page.send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
  }
  return result.result.value;
}

const onTarget = (target, body) =>
  `(() => { const el = (${finderSource})(${JSON.stringify(target)}); if (!el) return null; ${body} })()`;

async function waitFor(page, target, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await evaluate(page, onTarget(target, 'return true;'))) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for ${target}`);
}

async function fill(page, target, text) {
  await waitFor(page, target);
  await evaluate(page, onTarget(target, 'el.focus(); el.select?.(); return true;'));
  await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'a', code: 'KeyA', modifiers: 2 });
  await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'a', code: 'KeyA', modifiers: 2 });
  await page.send('Input.insertText', { text });
}

async function click(page, target) {
  await waitFor(page, target);
  const box = await evaluate(
    page,
    onTarget(
      target,
      'el.scrollIntoView({ block: "center" }); const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 };'
    )
  );
  for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) {
    await page.send('Input.dispatchMouseEvent', { type, x: box.x, y: box.y, button: 'left', clickCount: 1 });
  }
}

async function navigate(page, url) {
  await page.send('Page.enable');
  await page.send('Page.navigate', { url });
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    if ((await evaluate(page, 'document.readyState')) === 'complete') return;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}

function defaultBackend() {
  if (process.env.VERIFY_BACKEND) return process.env.VERIFY_BACKEND;
  return process.env.WSL_DISTRO_NAME ? 'http://127.0.0.1:8317' : 'http://windows-host:8317';
}

async function login(page) {
  if (existsSync(loginFailedMarker)) {
    throw new Error(
      `A previous login failed (${loginFailedMarker}). The proxy bans an address after five wrong keys. ` +
        'Fix the key in ~/.secrets, then delete the marker by hand.'
    );
  }
  const key = process.env.CLIPROXY_MANAGEMENT_KEY;
  if (!key) throw new Error('CLIPROXY_MANAGEMENT_KEY is empty. Run: source ~/.secrets');
  await navigate(page, session.DEV_URL);
  await waitFor(page, 'input[name="cpa-management-key"]');
  await click(page, 'button[aria-controls]');
  await fill(page, 'input[type="url"]', defaultBackend());
  await fill(page, 'input[name="cpa-management-key"]', key);
  await click(page, 'button[type="submit"]');
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    const state = await evaluate(
      page,
      `(() => {
        if (!document.querySelector('input[name="cpa-management-key"]')) return 'in';
        const alert = document.querySelector('form [role="alert"]');
        return alert ? 'error:' + alert.innerText : 'pending';
      })()`
    );
    if (state === 'in') return 'logged in';
    if (state.startsWith('error:')) {
      if (/authentication|unauthori|invalid|denied|banned/i.test(state)) {
        writeFileSync(loginFailedMarker, `${new Date().toISOString()} ${state}\n`);
      }
      throw new Error(`Login failed: ${state.slice(6)}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error('Login timed out');
}

const [command, ...args] = process.argv.slice(2);

if (command === 'close') {
  const browser = await connect(await browserSocketUrl());
  await browser.send('Browser.close').catch(() => {});
  browser.close();
  process.exit(0);
}

const emulationFile = `${stateDir}/emulation.json`;
const emulation = existsSync(emulationFile) ? JSON.parse(readFileSync(emulationFile, 'utf8')) : {};

async function applyEmulation(page) {
  if (!emulation.width) return;
  const current = await evaluate(page, '[innerWidth, innerHeight]');
  await page.send('Emulation.setDeviceMetricsOverride', {
    width: emulation.width,
    height: emulation.height,
    deviceScaleFactor: 1,
    mobile: emulation.width < 600,
  });
  if (current[0] !== emulation.width || current[1] !== emulation.height) {
    await new Promise((resolve) => setTimeout(resolve, 900));
  }
}

const page = await connect(await pageSocketUrl());
try {
  await applyEmulation(page);
  switch (command) {
    case 'open':
      await navigate(page, args[0]);
      console.log(await evaluate(page, 'location.href'));
      break;
    case 'login':
      console.log(await login(page));
      break;
    case 'route': {
      await evaluate(page, `location.hash = ${JSON.stringify(args[0])}`);
      await new Promise((resolve) => setTimeout(resolve, 300));
      console.log(await evaluate(page, 'location.href'));
      break;
    }
    case 'wait':
      await waitFor(page, args[0], Number(args[1] ?? 15000));
      console.log('visible');
      break;
    case 'click':
      await click(page, args[0]);
      console.log('clicked');
      break;
    case 'fill':
      await fill(page, args[0], args[1] ?? '');
      console.log('filled');
      break;
    case 'text': {
      await waitFor(page, args[0]);
      console.log(await evaluate(page, onTarget(args[0], 'return el.innerText;')));
      break;
    }
    case 'eval':
      console.log(JSON.stringify(await evaluate(page, args[0]), null, 2));
      break;
    case 'shot': {
      const [file, target] = args;
      const params = { format: 'png', captureBeyondViewport: false };
      if (target) {
        await waitFor(page, target);
        const box = await evaluate(
          page,
          onTarget(
            target,
            'el.scrollIntoView({ block: "start" }); const r = el.getBoundingClientRect(); return { x: r.x + scrollX, y: r.y + scrollY, width: r.width, height: r.height };'
          )
        );
        params.clip = { ...box, scale: 1 };
        params.captureBeyondViewport = true;
      }
      const { data } = await page.send('Page.captureScreenshot', params);
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, Buffer.from(data, 'base64'));
      console.log(file);
      break;
    }
    case 'redact': {
      const masked = await evaluate(
        page,
        `(() => {
          const pattern = /([A-Za-z0-9._%+-]+)@([A-Za-z0-9.-]+\\.[A-Za-z]{2,})/g;
          const mask = (text) => text.replace(pattern, (_, local, domain) => local.slice(0, 2) + '***@***.' + domain.split('.').pop());
          let count = 0;
          const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
          while (walker.nextNode()) {
            const node = walker.currentNode;
            const next = mask(node.nodeValue);
            if (next !== node.nodeValue) { node.nodeValue = next; count++; }
          }
          for (const el of document.querySelectorAll('[title]')) el.title = mask(el.title);
          return count;
        })()`
      );
      console.log(`masked ${masked} text nodes`);
      break;
    }
    case 'theme': {
      const labels = { dark: 'Dark', light: 'Pure White', paper: 'Wool Paper', auto: 'Follow system' };
      const label = labels[args[0]];
      if (!label) throw new Error('theme takes dark, light, paper or auto');
      await click(page, 'role=button:Theme');
      await click(page, `role=menuitemradio:${label}`);
      await new Promise((resolve) => setTimeout(resolve, 600));
      console.log(`theme ${args[0]}: ${await evaluate(page, "document.documentElement.dataset.theme ?? 'paper'")}`);
      break;
    }
    case 'size':
      emulation.width = Number(args[0]);
      emulation.height = Number(args[1]);
      writeFileSync(emulationFile, JSON.stringify(emulation));
      await applyEmulation(page);
      console.log(`size ${args[0]}x${args[1]}`);
      break;
    default:
      console.error(`Unknown command: ${command}`);
      process.exitCode = 2;
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  page.close();
}
