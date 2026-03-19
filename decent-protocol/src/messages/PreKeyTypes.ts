export const PRE_KEY_BUNDLE_VERSION = 1 as const;

export type PreKeyType = 'signed' | 'one-time';

export interface SignedPreKeyBundleEntry {
  keyId: number;
  publicKey: string;
  signature: string;
  createdAt: number;
  expiresAt: number;
}

export interface OneTimePreKeyBundleEntry {
  keyId: number;
  publicKey: string;
  createdAt: number;
}

export interface PreKeyBundle {
  version: typeof PRE_KEY_BUNDLE_VERSION;
  peerId: string;
  generatedAt: number;
  signingPublicKey: string;
  signedPreKey: SignedPreKeyBundleEntry;
  oneTimePreKeys: OneTimePreKeyBundleEntry[];
}

export interface PersistedLocalPreKeyRecord {
  keyId: number;
  publicKey: string;
  privateKey: string;
  createdAt: number;
}

export interface PersistedSignedPreKeyRecord extends PersistedLocalPreKeyRecord {
  signature: string;
  expiresAt: number;
}

export interface PersistedLocalPreKeyState {
  version: typeof PRE_KEY_BUNDLE_VERSION;
  generatedAt: number;
  signedPreKey: PersistedSignedPreKeyRecord;
  oneTimePreKeys: PersistedLocalPreKeyRecord[];
  nextOneTimePreKeyId: number;
}

export interface PreKeySessionInitPayload {
  type: 'pre-key-session-init';
  bundleVersion: typeof PRE_KEY_BUNDLE_VERSION;
  selectedPreKeyId: number;
  selectedPreKeyType: PreKeyType;
  senderEphemeralPublicKey: string;
  createdAt: number;
}

export interface PreKeyBundlePublishMessage {
  type: 'pre-key-bundle.publish';
  bundle: PreKeyBundle;
}

export interface PreKeyBundleRequestMessage {
  type: 'pre-key-bundle.request';
}

export interface PreKeyBundleResponseMessage {
  type: 'pre-key-bundle.response';
  bundle?: PreKeyBundle;
  notAvailable?: boolean;
}

export type PreKeyBundleFetchQuerySource = 'custodian-targeted' | 'peer-broadcast';

export interface PreKeyBundleFetchMessage {
  type: 'pre-key-bundle.fetch';
  requestId: string;
  ownerPeerId: string;
  workspaceId?: string;
  querySource?: PreKeyBundleFetchQuerySource;
}

export interface PreKeyBundleFetchResponseMessage {
  type: 'pre-key-bundle.fetch-response';
  requestId: string;
  ownerPeerId: string;
  workspaceId?: string;
  querySource?: PreKeyBundleFetchQuerySource;
  bundle?: PreKeyBundle;
  notAvailable?: boolean;
}
