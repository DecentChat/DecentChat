import { defineConfig } from "vitepress";

export default defineConfig({
  title: "DecentChat Docs",
  description: "Documentation for the DecentChat monorepo",
  cleanUrls: true,
  themeConfig: {
    logo: "/decentchat-logo.png",
    nav: [
      { text: "User Guide", link: "/user/" },
      { text: "Protocol", link: "/protocol/" },
      { text: "UI", link: "/ui/" },
      { text: "OpenClaw Plugin", link: "/openclaw/" },
      { text: "Docs Home", link: "/" }
    ],
    search: {
      provider: "local"
    },
    sidebar: [
      {
        text: "User Guide",
        items: [
          { text: "Overview", link: "/user/" },
          { text: "Quick Start", link: "/user/quick-start" },
          { text: "Features Overview", link: "/user/features-overview" },
          { text: "Roles and Permissions", link: "/user/roles-and-permissions" },
          { text: "How DecentChat Works", link: "/user/how-decentchat-works" },
          { text: "Decentralization Explained", link: "/user/decentralization-explained" },
          { text: "Sync Diagram", link: "/user/sync-diagram" },
          { text: "Sync, Multi-Device, and Backup", link: "/user/sync-and-backup" },
          { text: "FAQ", link: "/user/faq" }
        ]
      },
      {
        text: "Protocol",
        items: [
          { text: "Protocol Overview", link: "/protocol/" },
          { text: "Identity / Seed", link: "/protocol/identity-seed" },
          { text: "Crypto", link: "/protocol/crypto" },
          { text: "Sync / Negentropy", link: "/protocol/sync-negentropy" },
          { text: "CRDT / Vector Clocks", link: "/protocol/crdt-vector-clocks" },
          { text: "Hash Chain Integrity", link: "/protocol/hash-chain-integrity" },
          { text: "Gossip", link: "/protocol/gossip" },
          { text: "Delivery ACK", link: "/protocol/delivery-ack" },
          { text: "At-Rest Encryption", link: "/protocol/at-rest-encryption" },
          { text: "Invites", link: "/protocol/invites" }
        ]
      },
      {
        text: "UI",
        items: [
          { text: "UI Guide", link: "/ui/" },
          { text: "UI & UX Implementation Status", link: "/ui/ux-implementation-status" }
        ]
      },
      {
        text: "OpenClaw Plugin",
        items: [
          { text: "Plugin Overview", link: "/openclaw/" },
          { text: "Configuration", link: "/openclaw/configuration" },
          { text: "Architecture", link: "/openclaw/architecture" },
          { text: "Event Flow", link: "/openclaw/event-flow" },
          { text: "Operations & Troubleshooting", link: "/openclaw/operations" }
        ]
      },
      {
        text: "Core",
        items: [
          { text: "Getting Started", link: "/getting-started" },
          { text: "Architecture", link: "/architecture" },
          { text: "Development", link: "/development" },
          { text: "Testing", link: "/testing" },
          { text: "Deployment", link: "/deployment" },
          { text: "Troubleshooting", link: "/troubleshooting" }
        ]
      },
      {
        text: "Product",
        items: [{ text: "Landing Routing", link: "/product/landing-routing" }]
      },
      {
        text: "Client",
        items: [{ text: "Join Workspace Dialog", link: "/client/join-workspace-dialog" }]
      }
    ]
  }
});
