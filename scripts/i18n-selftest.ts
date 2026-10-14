import { Input } from "../client/src/input.ts";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { chooseLocale, initializeLocale, setLocale, getLocale, t, english, simplifiedChinese, LANGUAGE_KEY, paintStatic } from "../client/src/i18n.ts";
assert.equal(chooseLocale(null, ["zh-TW", "en"]), "zh-CN");
assert.equal(chooseLocale(null, ["en-US", "zh-CN"]), "en");
assert.equal(chooseLocale("bad", ["zh-CN"]), "zh-CN");
assert.equal(chooseLocale("en", ["zh-CN"]), "en");
assert.equal(chooseLocale("zh-CN", ["en"]), "zh-CN");
assert.equal(chooseLocale(null, []), "en");
assert.equal(chooseLocale(null, ["fr-FR", "zh-CN", "en-US"]), "zh-CN");
assert.equal(chooseLocale(null, ["fr-FR", "de"]), "en");
const values = new Map<string,string>();
const title = { dataset: { i18n: "暴走台球" }, textContent: "" };
const input = { attributes: new Map([["data-i18n-placeholder", "名字"]]), value: "你 · 花色",
 getAttribute(key: string) { return this.attributes.get(key)!; }, setAttribute(key: string, value: string) { this.attributes.set(key, value); } };
const doc = { documentElement: { lang: "" }, title: "", querySelectorAll(selector: string) { return selector === "[data-i18n]" ? [title] : selector === "[data-i18n-placeholder]" ? [input] : []; } };
Object.defineProperty(globalThis, "navigator", { configurable: true, value: { languages: ["zh-HK"], language: "en" } });
Object.assign(globalThis, { document: doc, localStorage: { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key,value) } });
initializeLocale(); assert.equal(getLocale(), "zh-CN");
setLocale("en"); paintStatic();
assert.equal(doc.documentElement.lang, "en"); assert.equal(doc.title, "Iron Cage Billiards");
assert.equal(title.textContent, "Iron Cage Billiards"); assert.equal(input.attributes.get("placeholder"), "Name");
assert.equal(input.value, "你 · 花色"); assert.equal(values.get(LANGUAGE_KEY), "en");
assert.equal(t("房间 ABCD · 第 12 杆"), "Room ABCD · Shot 12");
assert.equal(t("全色 1–7 · 剩余 4 球"), "Solids 1–7 · 4 left");
assert.equal(t("对手抽中「磁铁球」"), "Opponent drew “Magnet”");
assert.equal(t("对方 · 8 号进袋"), "Opponent · Ball 8 pocketed");
assert.equal(t("你白球落袋且黑 8 进袋，判负"), "You · Cue ball scratch and 8-ball pocketed: loss");
for (const [source, translation] of Object.entries(english)) {
 assert.ok(!/\p{Script=Han}/u.test(translation), source);
 assert.equal(t(source), translation);
}
// Audit every authored static localization key and Chinese literal in the presentation/rules sources.
const html = readFileSync(new URL("../client/index.html", import.meta.url), "utf8");
for (const match of html.matchAll(/data-i18n(?:-placeholder|-aria-label|-title)?="([^"]+)"/g)) {
 const key = match[1]!.replaceAll("&quot;", '"').replaceAll("&amp;", "&");
 assert.ok(english[key] !== undefined || simplifiedChinese[key] !== undefined, `Missing static key: ${key}`);
}
for (const file of ["client/src/ui.ts", "client/src/net.ts", "client/src/game/game.ts", "client/src/game/rules.ts", "client/src/game/upgrades.ts", "server/src/match.ts", "server/src/rooms.ts"]) {
 const code = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
 for (const match of code.matchAll(/"([^"\n]*\p{Script=Han}[^"\n]*)"/gu)) assert.ok(!/\p{Script=Han}/u.test(t(match[1]!)), `Untranslated ${file}: ${match[1]} => ${t(match[1]!)}`);
}
setLocale("zh-CN"); paintStatic(); assert.equal(title.textContent, "暴走台球");
assert.equal(t("EVERY 3 BALLS"), "每进三球");
assert.equal(t("白球落袋 · 对手自由球"), "白球落袋 · 对手自由球");
Object.assign(globalThis, { localStorage: { getItem() { throw Error("denied"); }, setItem() { throw Error("denied"); } } });
initializeLocale(); assert.equal(getLocale(), "zh-CN"); setLocale("en"); assert.equal(doc.documentElement.lang, "en");
console.log("i18n preference, persistence, safe input binding, round-trip and complete source catalog checks passed");

// Exercise the real attached input listeners: focused UI must keep native Space/Enter
// and arrow behavior; moving focus while holding a game key must still release it.

class Control extends EventTarget {
  constructor(readonly tag: string, readonly parent: Control | null = null, readonly isContentEditable = false) { super(); }
  closest(selector: string): Control | null {
    return selector.split(", ").includes(this.tag) ? this : this.parent?.closest(selector) ?? null;
  }
}
const browser = new EventTarget();
Object.assign(globalThis, { HTMLElement: Control, window: browser, document: Object.assign(new EventTarget(), { hidden: false }) });
const inputHandler = new Input(); inputHandler.attach(new Control("canvas") as unknown as HTMLElement);
const keyEvent = (type: string, code: string, target: Control): Event => {
 const event = new Event(type, { cancelable: true });
 Object.defineProperties(event, { code: { value: code }, repeat: { value: false }, target: { value: target } });
 browser.dispatchEvent(event); return event;
};
for (const target of [new Control("button"), new Control("span", new Control("button")), new Control("input"), new Control("select"), new Control("textarea"), new Control("div", null, true)]) {
 for (const code of ["Space", "Enter", "ArrowLeft", "KeyM"]) {
  const event = keyEvent("keydown", code, target);
  assert.equal(event.defaultPrevented, false, `${target.tag} ${code} must retain native behavior`);
  assert.equal(inputHandler.keys.size, 0); assert.equal(inputHandler.pressed.size, 0);
 }
}
const gameSurface = new Control("canvas");
assert.equal(keyEvent("keydown", "Space", gameSurface).defaultPrevented, true);
assert.ok(inputHandler.keys.has("Space")); assert.ok(inputHandler.pressed.has("Space"));
keyEvent("keyup", "Space", new Control("button"));
assert.equal(inputHandler.keys.has("Space"), false); assert.ok(inputHandler.released.has("Space"));
console.log("PASS focused-control keyboard activation, game input and focus-change keyup cleanup");
