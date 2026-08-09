// Wrapper autour de browser.runtime.sendMessage (content/popup/options → background).
// Le background répond soit avec sa charge utile, soit avec { error }.

self.NCC = self.NCC || {};

(() => {
  const NCC = self.NCC;

  NCC.sendToBackground = async function sendToBackground(request) {
    const response = await NCC.browser.runtime.sendMessage(request);
    if (typeof response === "object" && response !== null && "error" in response) {
      throw new Error(response.error);
    }
    return response;
  };
})();
