<!--
  SvelteReady — Smoke-test component.
  Renders a hidden marker element that E2E tests can check to verify
  Svelte is compiled and mounted correctly.
  Delete this once real components are in place.
-->
<script lang="ts">
  const version = '5';
</script>

<div data-testid="svelte-ready" data-svelte-version={version} style="display:none" aria-hidden="true">
  Svelte {version} active
</div>
