const VENDOR_BASE_URL = new URL("./vendor/", import.meta.url);

let codecPromise = null;

function loadClassicScript(fileName, globalName) {
  if (globalThis[globalName]) return Promise.resolve(globalThis[globalName]);
  if (typeof document === "undefined") {
    return Promise.reject(new Error(`The browser DICOM codec dependency ${fileName} is unavailable.`));
  }
  const url = new URL(fileName, VENDOR_BASE_URL).href;
  const existing = [...document.scripts].find((script) => script.src === url);
  return new Promise((resolve, reject) => {
    const script = existing || document.createElement("script");
    const finish = () => {
      if (globalThis[globalName]) resolve(globalThis[globalName]);
      else reject(new Error(`${fileName} loaded without exposing ${globalName}.`));
    };
    script.addEventListener("load", finish, { once: true });
    script.addEventListener(
      "error",
      () => reject(new Error(`Could not load the local DICOM codec dependency ${fileName}.`)),
      { once: true },
    );
    if (!existing) {
      script.src = url;
      script.async = true;
      script.crossOrigin = "anonymous";
      document.head.append(script);
    }
  });
}

/**
 * Lazily loads the browser-only DICOM codec payload. All URLs are resolved from this module so a
 * GitHub Pages repository base path does not need configuration.
 */
export function getDicomCodecs() {
  if (!codecPromise) {
    codecPromise = (async () => {
      await loadClassicScript("dcmjs.min.js", "dcmjs");
      const codecs = await loadClassicScript("dcmjs-codecs.min.js", "dcmjsCodecs");
      if (!codecs.NativeCodecs.isInitialized()) {
        await codecs.NativeCodecs.initializeAsync({
          webAssemblyModulePathOrUrl: new URL("dcmjs-native-codecs.wasm", VENDOR_BASE_URL).href,
          logCodecsInfo: false,
          logCodecsTrace: false,
        });
      }
      return codecs;
    })().catch((error) => {
      codecPromise = null;
      throw error;
    });
  }
  return codecPromise;
}
