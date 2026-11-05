import {
  BaseWindow,
  WebContentsView,
  type BrowserWindow,
  type Session,
  type WebContents,
} from "electron";
import {
  INITIAL_WEBVIEW_CRASH_RECOVERY_STATE,
  planWebviewCrashRecovery,
} from "@t3tools/shared/browserCrashRecovery";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Schema from "effect/Schema";
import type { DesktopPreviewPresentationInput } from "@t3tools/contracts";
import { PASSKEY_BRIDGE_ARGUMENT } from "./GuestProtocol.ts";

class NativeBrowserInitializationError extends Schema.TaggedError<NativeBrowserInitializationError>()(
  "NativeBrowserInitializationError",
  { cause: Schema.Defect() },
) {
  override get message(): string {
    return "The native browser view could not initialize.";
  }
}

const dialogParents = new WeakMap<WebContents, BrowserWindow>();
export const nativeBrowserDialogParent = (contents: WebContents): BrowserWindow | undefined =>
  dialogParents.get(contents);

export interface NativeBrowserViewBounds {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

const WRAPPER_URL = `data:text/html,${encodeURIComponent('<!doctype html><html style="width:100%;height:100%;overflow:hidden"><style>@media (prefers-reduced-motion: reduce){#native-agent-cursor{transition:none!important}}</style><body style="margin:0;overflow:hidden"><img id="native-agent-cursor" aria-hidden="true" style="display:none;position:absolute;left:0;top:0;z-index:2147483647;pointer-events:none;transition:transform 150ms ease-out,opacity 150ms ease-out"></body></html>')}`;
const closeContents = async (contents: WebContents | undefined) => {
  if (!contents || contents.isDestroyed()) return;
  const destroyed = new Promise<void>((resolve) => contents.once("destroyed", () => resolve()));
  contents.close({ waitForBeforeUnload: false });
  await destroyed;
};

export const createNativeBrowserView = async (options: {
  readonly session: Session;
  readonly partition: string;
  readonly passkeyBridgeEnabled?: boolean;
  readonly preload: string;
  readonly mainWindow: BrowserWindow;
  readonly width: number;
  readonly height: number;
  readonly zoomFactor: number;
  readonly onFailure: (description: string) => void;
}) => {
  const host = new BaseWindow({
    show: false,
    focusable: false,
    skipTaskbar: true,
    closable: false,
    useContentSize: true,
    width: options.width,
    height: options.height,
  });
  let view: WebContentsView;
  try {
    view = new WebContentsView({
      webPreferences: {
        partition: "t3-native-browser-wrapper",
        webviewTag: true,
        sandbox: true,
        nodeIntegration: false,
        contextIsolation: true,
        disableHtmlFullscreenWindowResize: true,
        backgroundThrottling: true,
      },
    });
  } catch (error) {
    host.destroy();
    throw error;
  }
  const wrapper = view.webContents;
  // Retain this handle for Electron's debugger lifetime, independently of the guest debugger.
  const wrapperDebugger = wrapper.debugger;
  let contents: WebContents | undefined;
  let owner: BaseWindow | null = null;
  let closed = false;
  let initialized = false;
  let closing: Promise<void> | undefined;
  let interactive = true;
  let mainWindow = options.mainWindow;
  let presentation: { bounds: NativeBrowserViewBounds; radius: number } | undefined;
  let bounds: NativeBrowserViewBounds = {
    x: 0,
    y: 0,
    width: options.width,
    height: options.height,
  };
  let radius = 0;
  let recovery = INITIAL_WEBVIEW_CRASH_RECOVERY_STATE;
  let recovering = false;
  let recoveryFiber: Fiber.Fiber<void> | undefined;
  const holds = new Set<"initialization" | "layout" | "protocol" | "frame-capture">();
  let renderingChange = Promise.resolve();
  const setRenderingActive = (consumer: Parameters<typeof holds.add>[0], enabled: boolean) => {
    const wasActive = holds.size > 0;
    if (enabled) holds.add(consumer);
    else holds.delete(consumer);
    const active = holds.size > 0;
    if (wasActive === active) return renderingChange;
    renderingChange = renderingChange
      .catch(() => {})
      .then(async () => {
        if (closed || wrapper.isDestroyed()) throw new Error("The native browser host is closed.");
        // The hidden parent also needs a Chromium capturer hold to composite its scaled guest.
        await wrapperDebugger.sendCommand("Emulation.setFocusEmulationEnabled", {
          enabled: active,
        });
      });
    return renderingChange;
  };
  const place = (window: BaseWindow, next: NativeBrowserViewBounds, nextRadius: number) => {
    if (closed || wrapper.isDestroyed()) throw new Error("The native browser page is closed.");
    if (window.isDestroyed()) throw new Error("The native browser destination is closed.");
    if (window !== owner) {
      if (owner && !owner.isDestroyed()) owner.contentView.removeChildView(view);
      owner = null;
      window.contentView.addChildView(view);
      owner = window;
    }
    view.setBounds(next);
    view.setBorderRadius(nextRadius);
    bounds = next;
    radius = nextRadius;
  };
  const park = () => place(host, { ...bounds, x: 0, y: 0 }, 0);
  const showPresentation = () => {
    if (closed || !presentation || mainWindow.isDestroyed()) return;
    if (!mainWindow.isVisible() || mainWindow.isMinimized()) park();
    else place(mainWindow, presentation.bounds, presentation.radius);
  };
  const hidePresentation = () => {
    if (!closed && !wrapper.isDestroyed()) park();
  };
  const bindWindow = () => {
    mainWindow.on("hide", hidePresentation);
    mainWindow.on("minimize", hidePresentation);
    mainWindow.on("close", hidePresentation);
    mainWindow.on("show", showPresentation);
    mainWindow.on("restore", showPresentation);
  };
  const unbindWindow = () => {
    mainWindow.off("hide", hidePresentation);
    mainWindow.off("minimize", hidePresentation);
    mainWindow.off("close", hidePresentation);
    mainWindow.off("show", showPresentation);
    mainWindow.off("restore", showPresentation);
  };
  const close = () => {
    closing ??= (async () => {
      closed = true;
      if (recoveryFiber) Effect.runFork(Fiber.interrupt(recoveryFiber));
      unbindWindow();
      if (contents) dialogParents.delete(contents);
      try {
        if (owner && !owner.isDestroyed()) owner.contentView.removeChildView(view);
        try {
          await closeContents(contents);
        } finally {
          await closeContents(wrapper);
        }
      } finally {
        if (!host.isDestroyed()) host.destroy();
      }
    })();
    return closing;
  };
  const failHost = () => {
    if (closed || !initialized) return;
    options.onFailure("The native browser host stopped. Close and reopen this browser tab.");
    void close().catch(() => {});
  };
  wrapper.on("render-process-gone", failHost);
  wrapper.once("destroyed", failHost);
  wrapper.setWindowOpenHandler(() => ({ action: "deny" }));
  wrapper.on("will-navigate", (event) => event.preventDefault());
  wrapper.on("will-redirect", (event) => event.preventDefault());
  let admitted = false;
  wrapper.on("will-attach-webview", (event, preferences, params) => {
    if (admitted || params.partition !== options.partition || params.src !== "about:blank") {
      event.preventDefault();
      return;
    }
    admitted = true;
    preferences.preload = options.preload;
    preferences.sandbox = true;
    preferences.nodeIntegration = false;
    preferences.nodeIntegrationInSubFrames = false;
    preferences.disableHtmlFullscreenWindowResize = true;
    // The picker reads the page's React DevTools hook, as on the existing webview path.
    preferences.contextIsolation = false;
    preferences.backgroundThrottling = true;
    preferences.additionalArguments = options.passkeyBridgeEnabled ? [PASSKEY_BRIDGE_ARGUMENT] : [];
  });
  try {
    host.contentView.addChildView(view);
    owner = host;
    view.setBounds(bounds);
    wrapper.setZoomMode("isolated");
    wrapper.setZoomFactor(1);
    const startup = async () => {
      await wrapper.loadURL(WRAPPER_URL);
      wrapperDebugger.attach("1.3");
      await setRenderingActive("initialization", true);
      wrapper.once("did-attach-webview", (_event, guest) => {
        contents = guest;
      });
      const id: unknown = await wrapper.executeJavaScript(`new Promise((resolve, reject) => {
        const page = document.createElement("webview");
        page.setAttribute("partition", ${JSON.stringify(options.partition)});
        page.setAttribute("allowpopups", "true");
        page.setAttribute("src", "about:blank");
        page.style.cssText = "display:flex;position:absolute;left:0;top:0;transform-origin:top left";
        page.style.width = ${JSON.stringify(`${options.width * options.zoomFactor}px`)};
        page.style.height = ${JSON.stringify(`${options.height * options.zoomFactor}px`)};
        page.addEventListener("dom-ready", () => resolve(page.getWebContentsId()), { once: true });
        page.addEventListener("destroyed", () => reject(new Error("The browser page closed during startup.")), { once: true });
        document.body.append(page);
      })`);
      if (!contents || contents.id !== id || contents.session !== options.session)
        throw new Error("The native browser page did not attach to its selected profile.");
      contents.setZoomMode("isolated");
      contents.setZoomFactor(options.zoomFactor);
      dialogParents.set(contents, mainWindow);
      contents.on("before-input-event", (event) => {
        if (!interactive) event.preventDefault();
      });
      contents.on("before-mouse-event", (event) => {
        if (!interactive) event.preventDefault();
      });
      contents.on("render-process-gone", () => {
        if (closed || recovering) return;
        recovering = true;
        recoveryFiber = Effect.runFork(
          Effect.gen(function* () {
            const plan = planWebviewCrashRecovery(recovery, yield* Clock.currentTimeMillis);
            if (!plan) return;
            recovery = plan.state;
            yield* Effect.sleep(plan.delayMs);
            if (!closed && contents && !contents.isDestroyed()) contents.reload();
          }).pipe(
            Effect.ensuring(
              Effect.sync(() => {
                recovering = false;
                recoveryFiber = undefined;
              }),
            ),
          ),
        );
      });
      bindWindow();
      await setRenderingActive("initialization", false);
    };
    await Effect.runPromise(
      Effect.tryPromise({
        try: startup,
        catch: (cause) => new NativeBrowserInitializationError({ cause }),
      }).pipe(Effect.timeout("10 seconds")),
    );
    initialized = true;
  } catch (error) {
    await close();
    throw error;
  }
  const guest = contents!;
  return {
    webContents: guest,
    setRenderingActive,
    present: (window: BrowserWindow, next: NativeBrowserViewBounds, cornerRadius: number) => {
      if (window !== mainWindow) throw new Error("The browser panel belongs to another window.");
      host.setContentSize(next.width, next.height);
      bounds = next;
      presentation = { bounds: next, radius: cornerRadius };
      showPresentation();
    },
    park: () => {
      presentation = undefined;
      park();
    },
    setLayout: async (
      size: { readonly width: number; readonly height: number },
      scale: number,
      width: number,
      height: number,
      cursor?: NonNullable<DesktopPreviewPresentationInput["nativeView"]>["cursor"],
    ) => {
      await setRenderingActive("layout", true);
      try {
        host.setContentSize(width, height);
        place(owner ?? host, { ...bounds, width, height }, radius);
        // Flush parent layout before a different renderer reads the guest's viewport.
        await wrapper.executeJavaScript(`(() => {
          const page = document.querySelector("webview");
          Object.assign(page.style, ${JSON.stringify({ width: `${size.width}px`, height: `${size.height}px`, transform: `scale(${scale})` })});
          const cursor = document.getElementById("native-agent-cursor");
          const mark = ${JSON.stringify(cursor ?? null)};
          cursor.style.display = mark ? "block" : "none";
          if (mark) {
            if (cursor.src !== mark.image) cursor.src = mark.image;
            Object.assign(cursor.style, {width: mark.width + "px", height: mark.height + "px", opacity: mark.opacity, transform: "translate3d(" + mark.x + "px," + mark.y + "px,0)"});
          }
          const rect = page.getBoundingClientRect();
          return { width: rect.width, height: rect.height };
        })()`);
      } finally {
        await setRenderingActive("layout", false);
      }
    },
    raise: () => {
      if (!closed && owner === mainWindow && !mainWindow.isDestroyed())
        mainWindow.contentView.addChildView(view);
    },
    setZoomFactor: (factor: number) => guest.setZoomFactor(factor),
    setInteractive: (value: boolean) => {
      interactive = value;
    },
    setMainWindow: (window: BrowserWindow) => {
      unbindWindow();
      mainWindow = window;
      dialogParents.set(guest, window);
      bindWindow();
    },
    close,
  };
};

export type NativeBrowserView = Awaited<ReturnType<typeof createNativeBrowserView>>;
