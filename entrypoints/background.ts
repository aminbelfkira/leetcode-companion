export default defineBackground(() => {
  console.log("[lcfsrs] background démarré");

  // Phase 0 : badge de test — remplacé en phase 3 par le vrai compteur de dus.
  void browser.action.setBadgeBackgroundColor({ color: "#ff5c5c" });
  void browser.action.setBadgeText({ text: "0" });
});
