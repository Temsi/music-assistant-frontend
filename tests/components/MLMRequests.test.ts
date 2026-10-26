import { mount, flushPromises } from "@vue/test-utils";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import MLMRequests from "@/views/MLMRequests.vue";
const { command, play } = vi.hoisted(() => ({
  command: vi.fn(),
  play: vi.fn(),
}));
vi.mock("@/plugins/api", () => ({
  api: {
    providers: {
      mlm_one: {
        domain: "mlm",
        instance_id: "mlm_one",
        name: "MLM",
        available: true,
      },
    },
    sendCommand: command,
    playMedia: play,
  },
}));
const selection = {
  kind: "song",
  id: "7",
  provider: "itunes",
  key: "itunes:7",
  title: "Song",
  artist: "Artist",
  album: "Album",
  album_id: "itunes:9",
  duration_s: 200,
};
const stubs = {
  VBtn: {
    props: ["disabled", "loading", "type", "to"],
    template: '<button :disabled="disabled" :type="type"><slot /></button>',
  },
  VTextField: {
    props: ["modelValue"],
    emits: ["update:modelValue"],
    template:
      '<input :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />',
  },
  VSelect: true,
  VAlert: { template: "<div><slot /></div>" },
};
let wrapper: ReturnType<typeof mount>;
beforeEach(() => {
  vi.useFakeTimers();
  command.mockReset();
  play.mockReset();
  command.mockImplementation(async (name: string) => {
    if (name.endsWith("/requests")) return { account: "thor", items: [] };
    if (name.endsWith("/catalog")) return { results: { songs: [selection] } };
    if (name.endsWith("/request"))
      return { id: 42, status: "pending", selection };
    throw new Error("Unexpected command");
  });
});
afterEach(() => {
  wrapper?.unmount();
  vi.useRealTimers();
});
it("loads saved state immediately and never requests from search", async () => {
  wrapper = mount(MLMRequests, { global: { stubs } });
  await flushPromises();
  expect(wrapper.text()).toContain("thor");
  await wrapper.get("input").setValue("Song");
  await wrapper.get("form").trigger("submit");
  await flushPromises();
  expect(command.mock.calls.some(([name]) => name === "mlm_one/request")).toBe(
    false,
  );
  const button = wrapper.findAll("button").find((b) => b.text() === "Request")!;
  await button.trigger("click");
  await flushPromises();
  expect(command).toHaveBeenCalledWith("mlm_one/request", {
    selection: expect.objectContaining({
      id: "7",
      duration_s: 200,
      album_id: "itunes:9",
    }),
  });
  expect(
    wrapper.findAll("button").filter((b) => b.text() === "Request"),
  ).toHaveLength(0);
});
it("resolves exact completed audio and revalidates before playback", async () => {
  const row = { id: 42, status: "acquired", selection };
  command.mockImplementation(async (name: string) =>
    name.endsWith("/requests")
      ? { account: "thor", items: [row] }
      : { ...row, uri: "mlm_one://track/l:9:25" },
  );
  wrapper = mount(MLMRequests, { global: { stubs } });
  await flushPromises();
  expect(wrapper.text()).toContain("Available");
  await wrapper
    .findAll("button")
    .find((b) => b.text() === "Play")!
    .trigger("click");
  await flushPromises();
  expect(play).toHaveBeenCalledWith("mlm_one://track/l:9:25", "play");
  expect(
    command.mock.calls.filter(([name]) => name.endsWith("/request_status")),
  ).toHaveLength(2);
  wrapper.unmount();
  await vi.advanceTimersByTimeAsync(11000);
  expect(
    command.mock.calls.filter(([name]) => name.endsWith("/requests")),
  ).toHaveLength(1);
});

it("clears Available after cancellation instead of retaining a stale playable URI", async () => {
  let status = "acquired";
  command.mockImplementation(async (name: string) =>
    name.endsWith("/requests")
      ? { account: "thor", items: [{ id: 42, status, selection }] }
      : { id: 42, status, selection, uri: "mlm_one://track/l:9:25" },
  );
  wrapper = mount(MLMRequests, { global: { stubs } });
  await flushPromises();
  expect(wrapper.text()).toContain("Available");
  status = "cancelled";
  await vi.advanceTimersByTimeAsync(10000);
  await flushPromises();
  expect(wrapper.text()).toContain("Cancelled");
  expect(wrapper.text()).not.toContain("Available");
  expect(play).not.toHaveBeenCalled();
});
