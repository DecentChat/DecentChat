<!--
  WelcomePage.svelte — Landing/onboarding page.
  Replaces renderWelcome() from UIRenderer.
-->
<script lang="ts">
  import { toast } from '../shared/Toast.svelte';

  interface Props {
    myPeerId: string;
    hasWorkspace: boolean;
    onCreateWorkspace: () => void;
    onJoinWorkspace: () => void;
    onRestoreSeed: () => void;
    onInstallAiTeam?: () => void;
  }

  let {
    myPeerId,
    hasWorkspace,
    onCreateWorkspace,
    onJoinWorkspace,
    onRestoreSeed,
    onInstallAiTeam,
  }: Props = $props();

  const isAppLikeRoute = typeof window !== 'undefined' && (window.location.pathname === '/app' || window.location.pathname.startsWith('/app/'));
  const donationAddresses = [
    {
      ticker: 'BTC',
      name: 'Bitcoin',
      address: 'bc1qj7rf9vc0nvk8maux6gc6dwzpelj2d3ck0krlm7',
    },
    {
      ticker: 'LTC',
      name: 'Litecoin',
      address: 'ltc1qjhsl7eztls8l557vrtmhlm4g86hlql2qq4x5jz',
    },
    {
      ticker: 'ETH',
      name: 'Ethereum',
      address: '0x33e98006401fE7298a255f5890380403e57cdf67',
    },
    {
      ticker: 'XMR',
      name: 'Monero',
      address: '42uEmNUt3Jp5qNpP8sg2rQf45eNEthvMadZutxT6z2eR3opSZepkN93cQ5wxdstyA2MfkyRjB93tgis6a5DBhqgh3u8PnZh',
    },
    {
      ticker: 'ZEC',
      name: 'Zcash',
      address: 'u1deqeprze5jdwz2ywmr3q9kmgdf4vel5shr8jeamm9upvrjlc08yqx55a0w2zq2kggaa4e7ctymw3nthqdv329l6vygypqd9228r9628y70anfk78mj9tld4hrjsh9zrlq7ekth6q23zhjlw7tsdrvsvcx53ggsclmuk6q7wl3cht9m5p',
    },
  ] as const;

  function handleCreate() {
    if (!isAppLikeRoute) {
      sessionStorage.setItem('decent:welcomeAction', 'create');
      window.location.assign('/app');
      return;
    }
    onCreateWorkspace();
  }

  function handleJoin() {
    if (!isAppLikeRoute) {
      sessionStorage.setItem('decent:welcomeAction', 'join');
      window.location.assign('/app');
      return;
    }
    onJoinWorkspace();
  }

  function handleOpenApp() {
    window.location.assign('/app');
  }

  function copyPeerId() {
    navigator.clipboard.writeText(myPeerId);
    toast('Peer ID copied!');
  }

  function copyDonationAddress(name: string, address: string) {
    navigator.clipboard.writeText(address);
    toast(`${name} address copied!`);
  }
</script>

<div class="landing-page">
  <!-- ── Sticky Nav ── -->
  <nav class="landing-nav">
    <div class="landing-nav-inner">
      <div class="landing-nav-brand">
        <img src="/icons/logo-v2-light.png" alt="Deci" class="landing-nav-logo" />
        <span class="landing-nav-name">DecentChat</span>
      </div>
      <div class="landing-nav-actions">
        <button class="btn-secondary btn-sm" id="join-ws-btn-nav" onclick={handleJoin}>Join workspace</button>
        <button class="btn-primary btn-sm" id="open-app-btn-nav" onclick={handleOpenApp}>Open App</button>
        {#if !hasWorkspace}
          <button class="btn-secondary btn-sm" id="create-ws-btn-nav" onclick={handleCreate}>Create workspace</button>
        {/if}
      </div>
    </div>
  </nav>

  <!-- ── Hero ── -->
  <section class="lp-hero">
    <div class="lp-hero-inner">
      <div class="lp-hero-badge">🔒 100% private · No servers · No accounts</div>
      <h1 class="lp-hero-title">Chat that belongs<br>to <em>you</em>.</h1>
      <p class="lp-hero-sub">
        WhatsApp stores your data. Telegram stores your data. Slack stores your data.
        <strong>DecentChat stores nothing.</strong> Messages go directly between people — encrypted, peer-to-peer, serverless.
      </p>
      <div class="lp-hero-actions">
        {#if hasWorkspace}
          <button class="btn-primary btn-lg" id="open-app-btn" onclick={handleOpenApp}>Open App →</button>
        {:else}
          <button class="btn-primary btn-lg" id="create-ws-btn" onclick={handleCreate}>Start Chatting Free →</button>
        {/if}
        <button class="btn-secondary btn-lg" id="join-ws-btn" onclick={handleJoin}>Join with Invite Code</button>
        {#if hasWorkspace && isAppLikeRoute && onInstallAiTeam}
          <button class="btn-secondary btn-lg" id="welcome-add-ai-team-btn" onclick={onInstallAiTeam}>Add AI Team</button>
        {/if}
      </div>
      <p class="lp-hero-note">No signup · No phone number · Works in your browser</p>
    </div>
    <div class="lp-hero-mascot">
      <img src="/icons/logo-v2-light.png" alt="Deci the DecentChat mascot" class="hero-deci" />
    </div>
  </section>

  <!-- ── Problem banner ── -->
  <section class="lp-problem">
    <div class="lp-container">
      <div class="lp-problem-grid">
        <div class="lp-problem-item">
          <span class="lp-problem-icon">📡</span>
          <strong>WhatsApp</strong> — owned by Meta, messages on their servers
        </div>
        <div class="lp-problem-item">
          <span class="lp-problem-icon">🕵️</span>
          <strong>Telegram</strong> — not E2E by default, cloud stored
        </div>
        <div class="lp-problem-item">
          <span class="lp-problem-item-highlight">✅</span>
          <strong>DecentChat</strong> — zero servers, zero data collected
        </div>
      </div>
    </div>
  </section>

  <!-- ── How it works ── -->
  <section class="lp-how">
    <div class="lp-container">
      <h2 class="lp-section-title">How it works</h2>
      <p class="lp-section-sub">Two steps. No servers involved.</p>
      <div class="lp-steps">
        <div class="lp-step">
          <div class="lp-step-num">1</div>
          <div class="lp-step-content">
            <h3>Create your workspace or join one</h3>
            <p>Start your own workspace in one click, or paste an invite to join an existing one. Your secure seed identity is generated automatically in your browser.</p>
          </div>
        </div>
        <div class="lp-step-arrow">→</div>
        <div class="lp-step">
          <div class="lp-step-num">2</div>
          <div class="lp-step-content">
            <h3>Chat with total privacy</h3>
            <p>Messages are encrypted before leaving your device using Signal's Double Ratchet. Even the signaling server — the only server that exists — never sees your content.</p>
          </div>
        </div>
      </div>
    </div>
  </section>

  <!-- ── Features ── -->
  <section class="lp-features">
    <div class="lp-container">
      <h2 class="lp-section-title">Everything you need.<br>Nothing you don't.</h2>
      <div class="lp-features-grid">
        <div class="lp-feature-card">
          <div class="lp-feature-icon">🔒</div>
          <h3>Double Ratchet E2E</h3>
          <p>Same encryption protocol as Signal. Keys rotate with every single message — past messages stay private forever, even if keys are compromised.</p>
        </div>
        <div class="lp-feature-card">
          <div class="lp-feature-icon">🌐</div>
          <h3>True P2P — No Server</h3>
          <p>WebRTC peer-to-peer data channels. A tiny signaling server helps peers find each other, then disappears. Like BitTorrent, but for private chat.</p>
        </div>
        <div class="lp-feature-card">
          <div class="lp-feature-icon">🔑</div>
          <h3>Seed Phrase Identity</h3>
          <p>12 words = your permanent identity. Works on any device. Back it up on paper. No company, no cloud, no way to lock you out of your own account.</p>
        </div>
        <div class="lp-feature-card">
          <div class="lp-feature-icon">💬</div>
          <h3>Full-Featured Chat</h3>
          <p>Workspaces, channels, DMs, threads, reactions, file sharing, search, slash commands — everything Slack has, with none of the surveillance.</p>
        </div>
        <div class="lp-feature-card">
          <div class="lp-feature-icon">📱</div>
          <h3>Install Anywhere</h3>
          <p>Progressive Web App — install from any browser on any device. iOS, Android, desktop. No app store, no permissions you didn't ask for.</p>
        </div>
        <div class="lp-feature-card">
          <div class="lp-feature-icon">⚡</div>
          <h3>Offline-First Sync</h3>
          <p>Messages queue when offline and sync when peers reconnect using CRDTs and Negentropy set reconciliation. No message ever gets lost.</p>
        </div>
        <div class="lp-feature-card lp-feature-card--highlight">
          <div class="lp-feature-icon">🪪</div>
          <h3>No ID. No Face Scan. Ever.</h3>
          <p>While Discord now requires a government ID or face scan to access their platform, DecentChat requires nothing. No email, no phone, no identity checks — just 12 words that only you control.</p>
        </div>
      </div>
    </div>
  </section>

  <!-- ── Comparison ── -->
  <section class="lp-compare">
    <div class="lp-container">
      <h2 class="lp-section-title">The honest comparison</h2>
      <div class="lp-compare-table">
        <div class="lp-compare-header">
          <span>Feature</span>
          <span>Discord / WhatsApp / Telegram</span>
          <span class="lp-compare-us">DecentChat 🐙</span>
        </div>
        <div class="lp-compare-row">
          <span>Messages stored on servers</span>
          <span class="bad">✓ Yes</span>
          <span class="good">✗ Never</span>
        </div>
        <div class="lp-compare-row">
          <span>Requires phone / email</span>
          <span class="bad">✓ Required</span>
          <span class="good">✗ None needed</span>
        </div>
        <div class="lp-compare-row">
          <span>ID or face scan to access</span>
          <span class="bad">✓ Discord requires it now</span>
          <span class="good">✗ Never</span>
        </div>
        <div class="lp-compare-row">
          <span>End-to-end encrypted by default</span>
          <span class="mid">⚠️ Partial</span>
          <span class="good">✓ Always</span>
        </div>
        <div class="lp-compare-row">
          <span>Can be legally subpoenaed</span>
          <span class="bad">✓ Yes</span>
          <span class="good">Nothing to hand over</span>
        </div>
        <div class="lp-compare-row">
          <span>Survives company going bust</span>
          <span class="bad">✗ App dies too</span>
          <span class="good">✓ Protocol lives forever</span>
        </div>
        <div class="lp-compare-row">
          <span>Forward secrecy</span>
          <span class="mid">⚠️ Sometimes</span>
          <span class="good">✓ Every message</span>
        </div>
      </div>
    </div>
  </section>

  <!-- ── Tech stack ── -->
  <section class="lp-tech">
    <div class="lp-container">
      <h2 class="lp-section-title">Built on proven technology</h2>
      <div class="lp-tech-pills">
        <span class="lp-tech-pill">Signal's Double Ratchet</span>
        <span class="lp-tech-pill">WebRTC P2P</span>
        <span class="lp-tech-pill">BIP39 Seed Phrases</span>
        <span class="lp-tech-pill">AES-GCM-256</span>
        <span class="lp-tech-pill">ECDH P-256</span>
        <span class="lp-tech-pill">CRDTs + Vector Clocks</span>
        <span class="lp-tech-pill">Negentropy Set Sync</span>
        <span class="lp-tech-pill">IndexedDB Persistence</span>
        <span class="lp-tech-pill">Service Worker PWA</span>
      </div>
    </div>
  </section>

  <!-- ── Support / sponsorship ── -->
  <section class="lp-support">
    <div class="lp-container">
      <div class="lp-support-header">
        <div class="lp-hero-badge">⚡ Community funded</div>
        <h2 class="lp-section-title">Sponsor DecentChat</h2>
        <p class="lp-section-sub">
          If DecentChat is useful to you and you want to help fund development,
          protocol work, and infrastructure, donations are welcome.
        </p>
      </div>
      <div class="lp-support-grid">
        {#each donationAddresses as donation}
          <article class="lp-support-card">
            <div class="lp-support-card-top">
              <div>
                <div class="lp-support-ticker">{donation.ticker}</div>
                <h3>{donation.name}</h3>
              </div>
              <button
                class="lp-copy-btn"
                type="button"
                aria-label={`Copy ${donation.name} donation address`}
                onclick={() => copyDonationAddress(donation.name, donation.address)}
              >
                Copy
              </button>
            </div>
            <code class="lp-support-address">{donation.address}</code>
          </article>
        {/each}
      </div>
      <p class="lp-support-note">Direct crypto donations only for now. No token, no ICO, no VC gatekeepers.</p>
    </div>
  </section>

  <!-- ── Final CTA ── -->
  <section class="lp-final-cta">
    <div class="lp-container">
      <img src="/icons/logo-v2-light.png" alt="Deci" class="lp-cta-mascot" />
      <h2>Your conversations.<br>Your keys. Your rules.</h2>
      <p>Start in 10 seconds. No signup. No credit card. No catch.</p>
      <div class="lp-hero-actions" style="justify-content:center; margin-top: 24px;">
        {#if hasWorkspace}
          <button class="btn-primary btn-lg" id="open-app-btn-2" onclick={handleOpenApp}>Open App →</button>
        {:else}
          <button class="btn-primary btn-lg" id="create-ws-btn-2" onclick={handleCreate}>Start Chatting Free →</button>
        {/if}
        <button class="btn-secondary btn-lg" id="join-ws-btn-2" onclick={handleJoin}>Join with Invite Code</button>
      </div>
      <p class="lp-restore-hint">
        Already have an account?
        <button class="restore-link-btn" id="restore-identity-btn" onclick={onRestoreSeed}>Restore from seed phrase →</button>
      </p>
    </div>
  </section>

  <!-- ── Footer ── -->
  <footer class="lp-footer">
    <div class="lp-container">
      <div class="lp-footer-inner">
        <div class="lp-footer-brand">
          <img src="/icons/logo-v2-light.png" alt="Deci" style="width:24px;height:24px;margin-right:8px;" />
          <strong>DecentChat</strong>
        </div>
        <p class="lp-footer-note">Open protocol · No tracking · No ads · Built with ❤️ and WebRTC</p>
        <p class="lp-footer-peer">
          Your anonymous ID:
          <!-- svelte-ignore a11y_click_events_have_key_events -->
          <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
          <!-- svelte-ignore a11y_click_events_have_key_events -->
          <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
          <code id="welcome-peer-id" title="Click to copy" onclick={copyPeerId}>{myPeerId.slice(0, 20)}…</code>
        </p>
      </div>
    </div>
  </footer>
</div>
