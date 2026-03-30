// Extra named exports from <script module> blocks in our .svelte files.
// TypeScript's generic '*.svelte' module declaration only knows about default exports,
// so we augment it with the imperative helpers we call from uiService.ts.

declare module '*.svelte' {
  export const toast: (message: string, type?: 'info' | 'error' | 'success', duration?: number) => void;

  export const showModal: (
    title: string,
    bodyHTML: string,
    onSubmit: (form: HTMLFormElement) => boolean | void | Promise<boolean | void>,
    options?: {
      submitLabel?: string;
      cancelLabel?: string;
    },
  ) => HTMLDivElement;

  export const showMessageInfoModal: (info: any) => void;
  export const showChannelMembersModal: (config: any) => void;
  export const showWorkspaceMembersModal: (config: any) => void;
  export const showWorkspaceSettingsModal: (config: any) => void;
  export const showJoinWorkspaceModal: (config: any) => void;
  export const showPeerSelectModal: (config: any) => void;
  export const showAddContactModal: (config: any) => void;
  export const showSettingsModal: (config: any) => Promise<void>;
  export const createQRFlow: (config: any) => {
    showMyQR: (data: any) => Promise<void>;
    showScanQR: () => Promise<void>;
    showSeedQR: (mnemonic: string) => Promise<void>;
    showRestoreSeed: () => Promise<void>;
    close: () => void;
  };
}
