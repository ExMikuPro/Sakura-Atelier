"use strict";
(() => {
  const clone = (value) => JSON.parse(JSON.stringify(value));
  /** One serialized writer per workspace. Edits during a save are coalesced, never discarded. */
  class Autosave {
    constructor({
      revision = "",
      write,
      persist,
      onState,
      onSaved,
      validate,
      delay = 700,
      schedule = (fn, ms) => setTimeout(fn, ms),
      cancel = (timer) => clearTimeout(timer),
    }) {
      Object.assign(this, {
        revision,
        write,
        persist,
        onState,
        onSaved,
        validate,
        delay,
        schedule,
        cancel,
      });
      this.version = 0;
      this.state = "clean";
      this.inflight = false;
      this.blocked = false;
    }
    status(state, error) {
      this.state = state;
      this.error = error;
      this.onState?.(state, error);
    }
    edit(snapshot, immediate = false) {
      this.snapshot = clone(snapshot);
      this.version++;
      this.persist?.({ ...clone(this.snapshot), revision: this.revision });
      if (this.timer) this.cancel(this.timer);
      const error = this.validate?.(this.snapshot);
      if (error) {
        this.status("invalid", error);
        return;
      }
      if (this.blocked) {
        this.status("conflict", this.error);
        return;
      }
      this.status(this.inflight ? "saving" : "pending");
      if (immediate) void this.flush();
      else
        this.timer = this.schedule(() => {
          this.timer = undefined;
          void this.flush();
        }, this.delay);
    }
    async flush() {
      if (this.timer) {
        this.cancel(this.timer);
        this.timer = undefined;
      }
      if (
        this.inflight ||
        this.blocked ||
        !this.snapshot ||
        this.validate?.(this.snapshot)
      )
        return;
      const version = this.version;
      const payload = clone(this.snapshot);
      this.inflight = true;
      this.status("saving");
      try {
        const result = await this.write({
          ...payload,
          revision: this.revision,
        });
        this.revision = result.revision;
        this.onSaved?.(result, version === this.version);
        if (version === this.version) {
          this.snapshot = undefined;
          this.status("clean");
        } else this.status("pending");
      } catch (error) {
        this.blocked = error?.kind === "conflict";
        this.status(
          this.blocked
            ? "conflict"
            : error?.kind === "invalid"
              ? "invalid"
              : "error",
          error?.message || String(error),
        );
      } finally {
        this.inflight = false;
      }
      if (
        this.snapshot &&
        this.version !== version &&
        !["conflict", "error", "invalid"].includes(this.state)
      )
        await this.flush();
    }
    retry() {
      if (!this.blocked) void this.flush();
    }
    dispose() {
      if (this.timer) this.cancel(this.timer);
      this.timer = undefined;
      void this.flush();
    }
  }
  globalThis.AtelierAutosave = { Autosave };
})();
