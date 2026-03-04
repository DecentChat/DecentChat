<!--
  App.svelte — Root Svelte component mounted alongside vanilla DOM.
  During migration, this hosts shared UI elements (toast, etc.)
  that need to be present at all times. 
-->
<script lang="ts">
  import SvelteReady from './SvelteReady.svelte';
  import Toast from './Toast.svelte';
</script>

<SvelteReady />
<Toast />
