type HapticsImpactStyle = unknown;

type CapacitorCoreModule = {
  Capacitor: {
    isNativePlatform: () => boolean;
  };
};

type HapticsModule = {
  Haptics: {
    impact: (options: { style: HapticsImpactStyle }) => Promise<void>;
  };
  ImpactStyle: {
    Light: HapticsImpactStyle;
    Medium: HapticsImpactStyle;
  };
};

type StatusBarModule = {
  StatusBar: {
    setStyle: (options: { style: unknown }) => Promise<void>;
    setBackgroundColor: (options: { color: string }) => Promise<void>;
    setOverlaysWebView: (options: { overlay: boolean }) => Promise<void>;
  };
  Style: {
    Dark: unknown;
  };
};

type KeyboardModule = {
  Keyboard: {
    setResizeMode: (options: { mode: unknown }) => Promise<void>;
    setScroll: (options: { isDisabled: boolean }) => Promise<void>;
  };
  KeyboardResize: {
    Body: unknown;
  };
};

type AppModule = {
  App: {
    addListener: (
      eventName: 'backButton' | 'appStateChange',
      listener: ((state: { isActive: boolean }) => void) | (() => void),
    ) => Promise<void>;
  };
};

const loadModule = async <T>(moduleName: string): Promise<T> =>
  (await import(/* @vite-ignore */ moduleName)) as T;

async function loadOptionalModule<T>(moduleName: string): Promise<T | null> {
  try {
    return await loadModule<T>(moduleName);
  } catch {
    return null;
  }
}

let hapticsModule: HapticsModule | null = null;
let didAttemptHapticsLoad = false;

async function isNativePlatform(): Promise<boolean> {
  const coreModule = await loadOptionalModule<CapacitorCoreModule>('@capacitor/core');
  if (!coreModule) return false;
  return coreModule.Capacitor.isNativePlatform();
}

async function ensureHapticsModule(): Promise<HapticsModule | null> {
  if (hapticsModule) return hapticsModule;
  if (didAttemptHapticsLoad) return null;

  didAttemptHapticsLoad = true;
  hapticsModule = await loadOptionalModule<HapticsModule>('@capacitor/haptics');
  return hapticsModule;
}

export async function hapticLightImpact(): Promise<void> {
  const module = await ensureHapticsModule();
  if (!module) return;

  try {
    await module.Haptics.impact({ style: module.ImpactStyle.Light });
  } catch {
    // no-op: haptics are best-effort only
  }
}

export async function hapticMediumImpact(): Promise<void> {
  const module = await ensureHapticsModule();
  if (!module) return;

  try {
    await module.Haptics.impact({ style: module.ImpactStyle.Medium });
  } catch {
    // no-op: haptics are best-effort only
  }
}

export async function setupNativePlugins(): Promise<void> {
  if (!(await isNativePlatform())) return;

  try {
    const statusBar = await loadModule<StatusBarModule>('@capacitor/status-bar');
    await statusBar.StatusBar.setStyle({ style: statusBar.Style.Dark });
    await statusBar.StatusBar.setBackgroundColor({ color: '#00000000' });
    await statusBar.StatusBar.setOverlaysWebView({ overlay: true });
  } catch {
    // no-op in non-capacitor environments
  }

  try {
    const keyboard = await loadModule<KeyboardModule>('@capacitor/keyboard');
    await keyboard.Keyboard.setResizeMode({ mode: keyboard.KeyboardResize.Body });
    await keyboard.Keyboard.setScroll({ isDisabled: false });
  } catch {
    // no-op in non-capacitor environments
  }

  await ensureHapticsModule();

  try {
    const appModule = await loadModule<AppModule>('@capacitor/app');

    await appModule.App.addListener('backButton', () => {
      window.dispatchEvent(new CustomEvent('native:back-button'));
    });

    await appModule.App.addListener('appStateChange', (state: { isActive: boolean }) => {
      window.dispatchEvent(
        new CustomEvent('native:app-state', {
          detail: { isActive: state.isActive },
        }),
      );
    });
  } catch {
    // no-op in non-capacitor environments
  }
}
