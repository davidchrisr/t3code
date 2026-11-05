import { describe, expect, it, vi } from "vite-plus/test";

const state = vi.hoisted(() => ({
  resources: new Set<string>(),
  events: [] as string[],
  sequence: 0,
  failView: false,
  failAttach: false,
  session: {} as Electron.Session,
  style: {} as Record<string, string>,
  wrapper: undefined as Electron.WebContents | undefined,
}));

vi.mock("electron", async () => {
  const { EventEmitter } = await import("node:events");
  const VM = await import("node:vm");
  const createContents = (kind: string) => {
    const id = state.sequence++;
    const resource = `${kind}-${id}`;
    state.resources.add(resource);
    let destroyed = false;
    const contents = Object.assign(new EventEmitter(), {
      id,
      session: state.session,
      isDestroyed: () => destroyed,
      setZoomFactor: vi.fn(),
      setZoomMode: vi.fn(),
      setWindowOpenHandler: vi.fn(),
      loadURL: async () => undefined,
      reload: vi.fn(),
      debugger: { attach: vi.fn(), sendCommand: vi.fn(async () => ({})) },
      close: (options: { waitForBeforeUnload: boolean }) => {
        expect(options.waitForBeforeUnload).toBe(false);
        destroyed = true;
        state.events.push(`${kind}-close`);
        state.resources.delete(resource);
        contents.emit("destroyed");
      },
    });
    return contents;
  };
  class TestView {
    parent: TestWindow | null = null;
    bounds: unknown;
    radius = 0;
    readonly webContents;
    constructor(_options: unknown) {
      if (state.failView) throw new Error("view allocation failed");
      const wrapper = createContents("wrapper");
      const attributes: Record<string, string> = {};
      const listeners = new Map<string, () => void>();
      let guest: ReturnType<typeof createContents>;
      const page = {
        style: state.style,
        setAttribute: (name: string, value: string) => {
          attributes[name] = value;
        },
        addEventListener: (name: string, listener: () => void) => {
          listeners.set(name, listener);
        },
        getWebContentsId: () => guest.id,
        getBoundingClientRect: () => ({ width: 384, height: 216 }),
      };
      const context = VM.createContext({
        document: {
          createElement: () => page,
          querySelector: () => page,
          getElementById: () => ({ style: {} }),
          body: {
            append: () => {
              const preventDefault = vi.fn();
              wrapper.emit("will-attach-webview", { preventDefault }, {}, attributes);
              if (preventDefault.mock.calls.length) throw new Error("guest rejected");
              guest = createContents("page");
              wrapper.emit("did-attach-webview", {}, guest);
              listeners.get("dom-ready")?.();
            },
          },
        },
      });
      this.webContents = Object.assign(wrapper, {
        executeJavaScript: async (script: string) => VM.runInContext(script, context),
      });
      state.wrapper = this.webContents as unknown as Electron.WebContents;
    }
    setBounds(bounds: unknown) {
      this.bounds = bounds;
    }
    setBorderRadius(radius: number) {
      this.radius = radius;
    }
  }
  class TestWindow extends EventEmitter {
    readonly id = `host-${state.sequence++}`;
    readonly children: TestView[] = [];
    destroyed = false;
    readonly contentView = {
      children: this.children,
      addChildView: (view: TestView) => {
        if (state.failAttach) throw new Error("attachment failed");
        if (view.parent === this) {
          this.children.splice(this.children.indexOf(view), 1);
          this.children.push(view);
          return;
        }
        if (view.parent) throw new Error("page already has an owner");
        view.parent = this;
        this.children.push(view);
      },
      removeChildView: (view: TestView) => {
        expect(view.parent).toBe(this);
        view.parent = null;
        this.children.splice(this.children.indexOf(view), 1);
        state.events.push("detach");
      },
    };
    constructor(_options: unknown) {
      super();
      state.resources.add(this.id);
    }
    isDestroyed() {
      return this.destroyed;
    }
    isVisible() {
      return true;
    }
    isMinimized() {
      return false;
    }
    setContentSize() {}
    destroy() {
      this.destroyed = true;
      state.events.push("host-destroy");
      state.resources.delete(this.id);
    }
  }
  return { BaseWindow: TestWindow, WebContentsView: TestView };
});

import { BaseWindow } from "electron";
import { createNativeBrowserView, nativeBrowserDialogParent } from "./NativeBrowserView.ts";

const setup = () => {
  state.resources.clear();
  state.events.length = 0;
  state.sequence = 0;
  state.failView = false;
  state.failAttach = false;
  state.style = {};
  state.session = {} as Electron.Session;
  const mainWindow = new BaseWindow({ show: false }) as Electron.BrowserWindow;
  return {
    mainWindow,
    options: {
      mainWindow,
      session: state.session,
      partition: "test-profile",
      preload: "/preview-pick-preload.cjs",
      width: 1000,
      height: 700,
      zoomFactor: 1,
      onFailure: vi.fn(),
    },
  };
};

describe("native browser view ownership", () => {
  it("preserves the scaled page through transfers and releases both contents before the hidden host", async () => {
    const { mainWindow, options } = setup();
    const page = await createNativeBrowserView(options);
    const original = page.webContents;
    expect(original.setZoomMode).toHaveBeenCalledWith("isolated");
    expect(nativeBrowserDialogParent(original)).toBe(mainWindow);
    page.setZoomFactor(1.25);
    await page.setLayout({ width: 4800, height: 2700 }, 0.08, 384, 216);
    expect(state.style).toMatchObject({
      width: "4800px",
      height: "2700px",
      transform: "scale(0.08)",
    });
    expect(original.setZoomFactor).toHaveBeenLastCalledWith(1.25);
    page.present(mainWindow, { x: 10, y: 20, width: 384, height: 216 }, 8);
    expect(mainWindow.contentView.children).toHaveLength(1);
    mainWindow.emit("minimize");
    expect(mainWindow.contentView.children).toHaveLength(0);
    mainWindow.emit("restore");
    expect(mainWindow.contentView.children).toHaveLength(1);
    page.park();
    mainWindow.emit("show");
    expect(mainWindow.contentView.children).toHaveLength(0);
    expect(page.webContents).toBe(original);
    const preventDefault = vi.fn();
    page.setInteractive(false);
    original.emit("before-mouse-event", { preventDefault });
    original.emit("before-input-event", { preventDefault });
    expect(preventDefault).toHaveBeenCalledTimes(2);
    await page.close();
    expect(original.isDestroyed()).toBe(true);
    expect(nativeBrowserDialogParent(original)).toBeUndefined();
    expect(state.events.slice(-4)).toEqual([
      "detach",
      "page-close",
      "wrapper-close",
      "host-destroy",
    ]);
    expect(state.resources.size).toBe(1);
    await page.close();
    expect(mainWindow.listenerCount("restore")).toBe(0);
    mainWindow.destroy();
    expect(state.resources.size).toBe(0);
  });

  it.each(["allocation", "attachment"])(
    "releases partial resources after %s failure",
    async (failure) => {
      const { mainWindow, options } = setup();
      state.failView = failure === "allocation";
      state.failAttach = failure === "attachment";
      await expect(createNativeBrowserView(options)).rejects.toThrow();
      expect(state.resources.size).toBe(1);
      mainWindow.destroy();
      expect(state.resources.size).toBe(0);
    },
  );

  it("reports a failed wrapper and closes its page without replacing its identity", async () => {
    const { mainWindow, options } = setup();
    const page = await createNativeBrowserView(options);
    const destroyed = Promise.withResolvers<void>();
    page.webContents.once("destroyed", destroyed.resolve);
    state.wrapper!.emit("render-process-gone", {}, { reason: "crashed" });
    await destroyed.promise;
    await page.close();
    expect(options.onFailure).toHaveBeenCalledWith(expect.stringContaining("Close and reopen"));
    expect(state.resources.size).toBe(1);
    mainWindow.destroy();
    expect(state.resources.size).toBe(0);
  });

  it("keeps a protocol hold when frame capture and layout finish, and surfaces parent failure", async () => {
    const { mainWindow, options } = setup();
    const page = await createNativeBrowserView(options);
    const send = vi.mocked(state.wrapper!.debugger.sendCommand);
    send.mockClear();
    await page.setRenderingActive("protocol", true);
    await page.setRenderingActive("frame-capture", true);
    await page.setLayout({ width: 1000, height: 700 }, 0.4, 400, 280);
    await page.setRenderingActive("frame-capture", false);
    expect(send.mock.calls.map((call) => call[1])).toEqual([{ enabled: true }]);
    await page.setRenderingActive("protocol", false);
    expect(send.mock.calls.map((call) => call[1])).toEqual([{ enabled: true }, { enabled: false }]);
    send.mockRejectedValueOnce(new Error("parent stopped"));
    await expect(page.setRenderingActive("protocol", true)).rejects.toThrow("parent stopped");
    await page.close();
    mainWindow.destroy();
    expect(state.resources.size).toBe(0);
  });
});
