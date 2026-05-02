function requireDesktopApi() {
  if (!window.desktopApi) {
    throw new Error("desktop API is not available");
  }
  return window.desktopApi;
}

export function getDesktopApi() {
  return requireDesktopApi();
}
