export async function loadDesktopApplication({
  window,
  splashPath,
  onServerReady,
  startServer,
}) {
  const splashReady = window.loadFile(splashPath);
  const backendReady = startServer();
  const [, listener] = await Promise.all([splashReady, backendReady]);
  onServerReady(listener);
  await window.loadURL(listener.url);
  return listener;
}
