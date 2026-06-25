<template>
  <div>{{ msg }}</div>
</template>

<script lang="ts">
import { defineComponent } from "vue";
import { formatName } from "../utils";

export default defineComponent({
  props: { msg: String },
});
</script>
