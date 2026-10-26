<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { api } from "@/plugins/api";
import { QueueOption } from "@/plugins/api/interfaces";

type Selection = {
  kind: "song" | "album";
  id: string;
  provider: string;
  key: string;
  artist: string;
  title: string;
  album: string;
  album_id: string;
  year: string;
  duration_s: number | null;
  version_label: string;
  isrc: string;
};
type RequestRow = {
  id: number;
  selection: Selection;
  status: string;
  display_status: string;
  message: string;
  uri?: string;
  album_id?: number;
};
const providers = computed(() =>
  Object.values(api.providers).filter((p) => p.domain === "mlm" && p.available),
);
const provider = ref("");
const account = ref("");
const query = ref("");
const category = ref("songs");
const results = ref<Selection[]>([]);
const requests = ref<RequestRow[]>([]);
const searching = ref(false);
const submitting = ref<string | null>(null);
const error = ref("");
const offset = ref(0);
let generation = 0;
let disposed = false;
const resolvedAt = new Map<number, number>();
let timer: ReturnType<typeof setTimeout> | undefined;
const known = (s: Selection) =>
  requests.value.find(
    (r) =>
      r.selection.id === s.id &&
      r.selection.provider === s.provider &&
      r.selection.kind === s.kind &&
      r.selection.album_id === s.album_id,
  );
const label = (r: RequestRow) =>
  r.uri
    ? "Available"
    : {
        identifying: "Identifying",
        importing: "Importing",
        preparing: "Preparing",
        needs_attention: "Needs attention",
        acquired: "Imported",
        pending: "Queued",
        wanted: "Queued",
        queued: "Downloading",
        searching: "Searching",
        review: "Needs attention",
        cancelled: "Cancelled",
        canceled: "Cancelled",
        dismissed: "Cancelled",
        paused: "Paused",
      }[r.display_status || r.status] ||
      r.display_status?.replaceAll("_", " ") ||
      r.status;

async function refresh() {
  const current = generation;
  const selected = provider.value;
  if (!selected || disposed) return;
  try {
    const data = await api.sendCommand<{
      account: string;
      items: RequestRow[];
    }>(`${selected}/requests`, { offset: offset.value });
    if (current !== generation || disposed) return;
    account.value = data.account;
    if (error.value.startsWith("Cannot update requests")) error.value = "";
    // Resolve completed songs; retry an unavailable mapping once a minute. Playback always revalidates.
    const prior = new Map(requests.value.map((r) => [r.id, r]));
    requests.value = data.items.map((r) => ({
      ...r,
      uri: r.status === "acquired" ? prior.get(r.id)?.uri : undefined,
    }));
    for (const row of requests.value) {
      if (
        row.status !== "acquired" ||
        row.selection.kind !== "song" ||
        !!row.uri ||
        Date.now() - (resolvedAt.get(row.id) || 0) < 60000
      )
        continue;
      const detail = await api.sendCommand<RequestRow>(
        `${selected}/request_status`,
        { wanted_id: row.id },
      );
      if (current !== generation || disposed) return;
      resolvedAt.set(row.id, Date.now());
      Object.assign(row, { ...detail, uri: detail.uri });
    }
  } catch {
    if (current === generation)
      error.value =
        "Cannot update requests right now. Your saved requests are kept; we’ll retry automatically.";
  } finally {
    if (current === generation && !disposed) timer = setTimeout(refresh, 10000);
  }
}
watch(
  providers,
  (values) => {
    if (!values.some((p) => p.instance_id === provider.value))
      provider.value = values[0]?.instance_id || "";
  },
  { immediate: true },
);
watch(
  [provider, offset],
  () => {
    generation++;
    clearTimeout(timer);
    requests.value = [];
    resolvedAt.clear();
    results.value = [];
    account.value = "";
    error.value = "";
    void refresh();
  },
  { immediate: true },
);
onBeforeUnmount(() => {
  disposed = true;
  generation++;
  clearTimeout(timer);
});

async function search() {
  if (!query.value.trim() || !provider.value) return;
  searching.value = true;
  error.value = "";
  const current = generation;
  const kind = category.value === "songs" ? "song" : "album";
  try {
    const data = await api.sendCommand<{
      results: Record<string, Record<string, unknown>[]>;
    }>(`${provider.value}/catalog`, {
      query: query.value,
      category: category.value,
    });
    if (current !== generation) return;
    results.value = (
      data.results[kind === "song" ? "songs" : "albums"] || []
    ).map((row) => ({
      kind,
      id: String(row.id),
      provider: String(row.provider || ""),
      key: String(row.key || ""),
      artist: String(row.artist || ""),
      title: String(row.title || ""),
      album: String(row.album || ""),
      album_id: String(row.album_id || ""),
      year: String(row.year || ""),
      duration_s: Number(row.duration_s) > 0 ? Number(row.duration_s) : null,
      version_label: String(row.version_label || ""),
      isrc: String(row.isrc || ""),
    }));
  } catch {
    error.value =
      "Catalog search is unavailable right now. Please try again. Existing music can still play.";
  } finally {
    searching.value = false;
  }
}
async function request(selection: Selection, restartWantedId?: number) {
  if (submitting.value) return;
  submitting.value = selection.key || selection.id;
  error.value = "";
  const selected = provider.value;
  const current = generation;
  try {
    const row = await api.sendCommand<RequestRow>(`${selected}/request`, {
      selection: restartWantedId
        ? { ...selection, restart_wanted_id: restartWantedId }
        : selection,
    });
    if (
      current === generation &&
      !requests.value.some((r) => r.id === row.id)
    ) {
      requests.value = requests.value.filter((r) => r.id !== restartWantedId);
      requests.value.unshift(row);
    }
  } catch {
    error.value =
      "Could not confirm the request. Retry is safe: MLM will keep the same request if it was already saved.";
  } finally {
    submitting.value = null;
  }
}
async function play(row: RequestRow) {
  error.value = "";
  try {
    const detail = await api.sendCommand<RequestRow>(
      `${provider.value}/request_status`,
      { wanted_id: row.id },
    );
    Object.assign(row, { ...detail, uri: detail.uri });
    if (!detail.uri) {
      error.value =
        detail.message || "The imported audio is not available yet.";
      return;
    }
    await api.playMedia(detail.uri, QueueOption.PLAY);
  } catch {
    error.value =
      "Could not start playback. Check that a player is selected and try again.";
  }
}
</script>

<template>
  <section class="mlm-requests">
    <h1>Search &amp; request</h1>
    <p>Find music to add through MLM. Requests continue in the background.</p>
    <v-select
      v-if="providers.length > 1"
      v-model="provider"
      :items="providers"
      item-title="name"
      item-value="instance_id"
      label="MLM connection"
    />
    <p v-if="!providers.length">
      Add the MLM Development music provider in Settings to get started.
    </p>
    <p v-if="account">
      Requests use MLM account: <strong>{{ account }}</strong>
    </p>
    <v-alert v-if="error" type="warning" class="my-4" role="alert">{{
      error
    }}</v-alert>
    <form v-if="provider" class="search-form" @submit.prevent="search">
      <v-text-field
        v-model="query"
        label="Artist, song or album"
        maxlength="512"
        hide-details
      />
      <v-select
        v-model="category"
        :items="[
          { title: 'Songs', value: 'songs' },
          { title: 'Albums', value: 'albums' },
        ]"
        label="Search for"
        hide-details
      />
      <v-btn type="submit" :loading="searching" :disabled="!query.trim()"
        >Search</v-btn
      >
    </form>
    <ul class="result-list" aria-label="Catalog results">
      <li
        v-for="row in results"
        :key="`${row.provider}:${row.id}:${row.album_id}`"
      >
        <div>
          <strong>{{ row.title }}</strong>
          <p>{{ row.artist }} · {{ row.album }}</p>
          <small
            >{{ row.provider
            }}<template v-if="row.duration_s">
              · {{ Math.floor(row.duration_s / 60) }}:{{
                String(Math.round(row.duration_s % 60)).padStart(2, "0")
              }}</template
            ></small
          >
        </div>
        <v-btn
          v-if="
            known(row) &&
            ['cancelled', 'dismissed'].includes(known(row)!.status)
          "
          :disabled="!!submitting"
          @click="request(row, known(row)!.id)"
          >Request again</v-btn
        >
        <span v-else-if="known(row)" role="status">{{
          label(known(row)!)
        }}</span>
        <v-btn
          v-else
          :disabled="!!submitting || !row.artist || !row.album"
          :loading="submitting === (row.key || row.id)"
          @click="request(row)"
          >Request</v-btn
        >
      </li>
    </ul>
    <h2 class="mt-8">Your MLM requests</h2>
    <p v-if="!requests.length">No requests on this page yet.</p>
    <ul class="result-list" aria-label="Saved requests">
      <li v-for="row in requests" :key="row.id">
        <div>
          <strong>{{ row.selection.title }}</strong>
          <p>{{ row.selection.artist }} · {{ row.selection.album }}</p>
          <p role="status">{{ label(row) }}</p>
          <small>{{ row.message }}</small>
        </div>
        <v-btn
          v-if="row.selection.kind === 'song' && row.status === 'acquired'"
          @click="play(row)"
          >{{ row.uri ? "Play" : "Check availability" }}</v-btn
        >
        <v-btn
          v-else-if="
            row.selection.kind === 'album' &&
            row.status === 'acquired' &&
            row.album_id
          "
          :to="`/albums/${provider}/${row.album_id}`"
          >Open album</v-btn
        >
      </li>
    </ul>
    <div class="pagination">
      <v-btn :disabled="offset === 0" @click="offset = Math.max(0, offset - 25)"
        >Previous</v-btn
      ><v-btn :disabled="requests.length < 25" @click="offset += 25"
        >Next</v-btn
      >
    </div>
  </section>
</template>
<style scoped>
.mlm-requests {
  max-width: 960px;
  margin: 0 auto;
  padding: 16px 12px 96px;
}
h1 {
  font-size: 1.6rem;
  font-weight: 650;
}
h2 {
  font-size: 1.2rem;
  font-weight: 650;
}
.search-form {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 130px auto;
  align-items: center;
  gap: 12px;
  margin: 24px 0;
}
.result-list {
  list-style: none;
  padding: 0;
}
.result-list li {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 16px 0;
  border-bottom: 1px solid rgba(128, 128, 128, 0.25);
}
.result-list li > div {
  min-width: 0;
  overflow-wrap: anywhere;
}
small {
  opacity: 0.75;
}
.pagination {
  display: flex;
  gap: 12px;
  margin-top: 20px;
}
@media (max-width: 600px) {
  .search-form {
    grid-template-columns: 1fr 100px;
  }
  .search-form > :first-child {
    grid-column: 1 / -1;
  }
}
</style>
