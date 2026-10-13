import { Game } from "./game/game.ts";
import { Ui } from "./ui.ts";

const canvas = document.getElementById("view");
if (!(canvas instanceof HTMLCanvasElement)) throw new Error("canvas missing");

const coarse = window.matchMedia("(pointer: coarse)");
const syncTouchUi = (): void => {
  const touch = coarse.matches || navigator.maxTouchPoints > 0;
  document.body.classList.toggle("touch-ui", touch);
  document.body.classList.toggle("portrait", touch && window.innerHeight > window.innerWidth);
};
syncTouchUi();
coarse.addEventListener("change", syncTouchUi);
window.addEventListener("resize", syncTouchUi);
window.addEventListener("orientationchange", syncTouchUi);

const game = new Game(canvas);
const ui = new Ui();

ui.bind(game, () => {
  game.startRun();
});
game.onHud = () => ui.paint(game.hud());
ui.paint(game.hud());
