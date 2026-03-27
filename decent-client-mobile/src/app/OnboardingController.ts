import { SeedPhraseManager } from '@decentchat/protocol';

export class OnboardingController {
  static readonly SEED_STORAGE_KEY = 'decentchat-seed-phrase';
  static readonly ALIAS_STORAGE_KEY = 'decentchat-alias';

  private readonly seedPhraseManager = new SeedPhraseManager();

  constructor(
    private readonly storage: Storage | null = typeof window !== 'undefined' ? window.localStorage : null,
  ) {}

  hasIdentity(): boolean {
    return this.getSeedPhrase() !== null;
  }

  createIdentity(alias: string): string {
    const mnemonic = this.seedPhraseManager.generate().mnemonic;
    this.storeIdentity(mnemonic, alias);
    return mnemonic;
  }

  importIdentity(seedPhrase: string, alias: string): string {
    const normalizedSeedPhrase = this.normalizeSeedPhrase(seedPhrase);

    const validation = this.seedPhraseManager.validate(normalizedSeedPhrase);
    if (!validation.valid) {
      throw new Error(validation.error || 'Invalid seed phrase');
    }

    this.storeIdentity(normalizedSeedPhrase, alias);
    return normalizedSeedPhrase;
  }

  getSeedPhrase(): string | null {
    const stored = this.storage?.getItem(OnboardingController.SEED_STORAGE_KEY);
    if (!stored) return null;

    const normalized = this.normalizeSeedPhrase(stored);
    if (!normalized) return null;

    const validation = this.seedPhraseManager.validate(normalized);
    if (!validation.valid) return null;

    return normalized;
  }

  getAlias(): string {
    return this.storage?.getItem(OnboardingController.ALIAS_STORAGE_KEY)?.trim() || '';
  }

  clearIdentity(): void {
    this.storage?.removeItem(OnboardingController.SEED_STORAGE_KEY);
    this.storage?.removeItem(OnboardingController.ALIAS_STORAGE_KEY);
  }

  private storeIdentity(seedPhrase: string, alias: string): void {
    if (!this.storage) return;

    this.storage.setItem(OnboardingController.SEED_STORAGE_KEY, seedPhrase);
    this.storage.setItem(OnboardingController.ALIAS_STORAGE_KEY, alias.trim());
  }

  private normalizeSeedPhrase(seedPhrase: string): string {
    return seedPhrase.trim().toLowerCase().replace(/\s+/g, ' ');
  }
}
