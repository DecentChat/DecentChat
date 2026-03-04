<!--
  MemberList.svelte — Sidebar member list with online/offline grouping.
  Replaces the member rendering section in UIRenderer.renderSidebarHTML().
-->
<script lang="ts">
  import MemberRow from './MemberRow.svelte';

  interface MemberData {
    peerId: string;
    alias: string;
    isOnline: boolean;
    isMe: boolean;
    role?: string;
    isBot?: boolean;
    statusClass?: string;
    statusTitle?: string;
  }

  interface Props {
    members: MemberData[];
  }

  let { members }: Props = $props();

  let onlineMembers = $derived(members.filter(m => m.isOnline));
  let offlineMembers = $derived(members.filter(m => !m.isOnline));
</script>

<div class="sidebar-section" id="workspace-members-section" data-testid="member-list">
  {#if onlineMembers.length > 0}
    <div class="sidebar-section-header member-group-header">Online — {onlineMembers.length}</div>
    <div id="workspace-member-list-online">
      {#each onlineMembers as member (member.peerId)}
        <MemberRow {...member} />
      {/each}
    </div>
  {/if}
  {#if offlineMembers.length > 0}
    <div class="sidebar-section-header member-group-header">Offline — {offlineMembers.length}</div>
    <div id="workspace-member-list-offline" class="members-offline">
      {#each offlineMembers as member (member.peerId)}
        <MemberRow {...member} />
      {/each}
    </div>
  {/if}
</div>
