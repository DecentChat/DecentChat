/**
 * EmojiPicker — Lightweight inline emoji picker
 * No dependencies, uses native emoji.
 */

const EMOJI_CATEGORIES: Record<string, string[]> = {
  '😀 Smileys': [
    '😀','😃','😄','😁','😆','😅','🤣','😂','🙂','😊',
    '😇','🥰','😍','🤩','😘','😗','😚','😙','🥲','😋',
    '😛','😜','🤪','😝','🤑','🤗','🤭','🫢','🤫','🤔',
    '🫡','🤐','🤨','😐','😑','😶','🫥','😏','😒','🙄',
    '😬','🤥','😌','😔','😪','🤤','😴','😷','🤒','🤕',
    '🤢','🤮','🥵','🥶','🥴','😵','🤯','🤠','🥳','🥸',
    '😎','🤓','🧐','😕','🫤','😟','🙁','😮','😯','😲',
    '😳','🥺','🥹','😦','😧','😨','😰','😥','😢','😭',
    '😱','😖','😣','😞','😓','😩','😫','🥱','😤','😡',
    '😠','🤬','😈','👿','💀','☠️','💩','🤡','👹','👺',
  ],
  '👋 Gestures': [
    '👋','🤚','🖐️','✋','🖖','🫱','🫲','🫳','🫴','👌',
    '🤌','🤏','✌️','🤞','🫰','🤟','🤘','🤙','👈','👉',
    '👆','🖕','👇','☝️','🫵','👍','👎','✊','👊','🤛',
    '🤜','👏','🙌','🫶','👐','🤲','🤝','🙏','✍️','💪',
  ],
  '❤️ Hearts': [
    '❤️','🧡','💛','💚','💙','💜','🖤','🤍','🤎','💔',
    '❤️‍🔥','❤️‍🩹','💕','💞','💓','💗','💖','💘','💝','💟',
  ],
  '🎉 Objects': [
    '🎉','🎊','🎈','🎁','🏆','🥇','🏅','⭐','🌟','✨',
    '💫','🔥','💥','🎯','💡','📌','📎','🔗','🔒','🔑',
    '🗝️','🛡️','⚔️','🏴‍☠️','🚀','✈️','🌍','🌈','☀️','🌙',
  ],
  '👍 Reactions': [
    '👍','👎','❤️','😂','😮','😢','😡','🎉','🤔','👀',
    '🔥','💯','✅','❌','⚡','🙏','💪','🫡','🤝','👏',
  ],
};

export class EmojiPicker {
  private container: HTMLElement | null = null;
  private onSelect: ((emoji: string) => void) | null = null;
  private searchInput: HTMLInputElement | null = null;

  /**
   * Show the emoji picker anchored to an element
   */
  show(anchor: HTMLElement, onSelect: (emoji: string) => void): void {
    this.close();
    this.onSelect = onSelect;

    this.container = document.createElement('div');
    this.container.className = 'emoji-picker';
    this.container.innerHTML = `
      <div class="emoji-picker-search">
        <input type="text" placeholder="Search emoji..." class="emoji-search-input" />
      </div>
      <div class="emoji-picker-categories">
        ${Object.entries(EMOJI_CATEGORIES).map(([name, emojis]) => `
          <div class="emoji-category">
            <div class="emoji-category-name">${name}</div>
            <div class="emoji-grid">
              ${emojis.map(e => `<button class="emoji-btn" data-emoji="${e}">${e}</button>`).join('')}
            </div>
          </div>
        `).join('')}
      </div>
    `;

    // Position above anchor (desktop) or bottom sheet (mobile)
    const isMobile = window.innerWidth <= 768;
    if (!isMobile) {
      const rect = anchor.getBoundingClientRect();
      this.container.style.bottom = `${window.innerHeight - rect.top + 8}px`;
      this.container.style.left = `${rect.left}px`;
    }
    // On mobile, CSS handles positioning as a bottom sheet (bottom: 0, full-width)

    document.body.appendChild(this.container);

    // Event handlers
    this.container.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest('.emoji-btn') as HTMLElement;
      if (btn) {
        const emoji = btn.dataset.emoji!;
        this.onSelect?.(emoji);
        this.close();
      }
    });

    this.searchInput = this.container.querySelector('.emoji-search-input');
    this.searchInput?.focus();
    this.searchInput?.addEventListener('input', () => this.filterEmojis());

    // Close on outside click (after a tick to avoid immediate close)
    setTimeout(() => {
      document.addEventListener('click', this.outsideClickHandler);
      document.addEventListener('keydown', this.escHandler);
    }, 0);
  }

  close(): void {
    this.container?.remove();
    this.container = null;
    document.removeEventListener('click', this.outsideClickHandler);
    document.removeEventListener('keydown', this.escHandler);
  }

  private outsideClickHandler = (e: MouseEvent) => {
    if (this.container && !this.container.contains(e.target as Node)) {
      this.close();
    }
  };

  private escHandler = (e: KeyboardEvent) => {
    if (e.key === 'Escape') this.close();
  };

  private filterEmojis(): void {
    const query = this.searchInput?.value.toLowerCase() || '';
    if (!this.container) return;

    const categories = this.container.querySelectorAll('.emoji-category');
    categories.forEach(cat => {
      const buttons = cat.querySelectorAll('.emoji-btn') as NodeListOf<HTMLElement>;
      let anyVisible = false;
      buttons.forEach(btn => {
        const emoji = btn.dataset.emoji!;
        const visible = !query || emoji.includes(query);
        btn.style.display = visible ? '' : 'none';
        if (visible) anyVisible = true;
      });
      (cat as HTMLElement).style.display = anyVisible ? '' : 'none';
    });
  }
}
