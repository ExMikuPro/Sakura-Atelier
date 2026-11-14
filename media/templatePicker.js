"use strict";
/** Compact, dependency-free template picker. The body portal is never clipped by the sidebar. */
(() => {
  const fuzzy = (query, text) => {
    let i = 0;
    const needle = query.toLocaleLowerCase().replace(/\s/g, "");
    for (const ch of text.toLocaleLowerCase()) {
      if (ch === needle[i]) i++;
    }
    return i === needle.length;
  };
  class TemplatePicker {
    constructor({ translate, onSelect, onContext, onClose, getRecent }) {
      Object.assign(this, {
        translate,
        onSelect,
        onContext,
        onClose,
        getRecent,
      });
      this.collapsed = new Set();
      this.active = 0;
      this.query = "";
      this.items = [];
      this.key = this.key.bind(this);
      this.outside = this.outside.bind(this);
      this.position = this.position.bind(this);
    }
    show(anchor, catalog) {
      this.close(false);
      this.anchor = anchor;
      this.catalog = catalog;
      this.query = "";
      this.active = 0;
      this.popup = document.createElement("section");
      this.popup.className = "template-popover";
      this.popup.setAttribute("role", "dialog");
      this.popup.setAttribute(
        "aria-label",
        this.translate("Add New Configuration"),
      );
      document.body.append(this.popup);
      this.draw();
      this.position();
      document.addEventListener("pointerdown", this.outside, true);
      window.addEventListener("resize", this.position);
      this.anchor?.setAttribute("aria-expanded", "true");
      this.search.focus();
    }
    close(restore = true) {
      if (!this.popup) return;
      this.popup.remove();
      this.popup = undefined;
      document.removeEventListener("pointerdown", this.outside, true);
      window.removeEventListener("resize", this.position);
      this.anchor?.setAttribute("aria-expanded", "false");
      if (restore && this.anchor?.isConnected) this.anchor.focus();
      this.onClose?.();
    }
    outside(event) {
      if (
        !this.popup?.contains(event.target) &&
        !this.anchor?.contains(event.target)
      )
        this.close();
    }
    position() {
      if (!this.popup) return;
      const margin = 8;
      const rect = this.anchor?.isConnected
        ? this.anchor.getBoundingClientRect()
        : { left: 24, bottom: 80, top: 80 };
      const width = Math.min(480, window.innerWidth - margin * 2);
      const height = Math.min(590, window.innerHeight - margin * 2);
      this.popup.style.width = width + "px";
      this.popup.style.maxHeight = height + "px";
      this.popup.style.left =
        Math.max(
          margin,
          Math.min(rect.left, window.innerWidth - width - margin),
        ) + "px";
      this.popup.style.top =
        Math.max(
          margin,
          Math.min(rect.bottom + 6, window.innerHeight - height - margin),
        ) + "px";
    }
    update(catalog) {
      this.catalog = catalog;
      if (this.popup) {
        this.draw();
        this.search.focus();
        this.position();
      }
    }
    node(tag, text, cls) {
      const n = document.createElement(tag);
      if (text !== undefined) n.textContent = text;
      if (cls) n.className = cls;
      return n;
    }
    icon(name) {
      const n = this.node("span", undefined, "codicon codicon-" + name);
      n.setAttribute("aria-hidden", "true");
      return n;
    }
    draw() {
      const T = this.translate;
      this.popup.replaceChildren();
      const header = this.node("div", undefined, "template-heading");
      header.append(this.node("h2", T("Add New Configuration")));
      const close = this.node("button");
      close.append(this.icon("close"));
      close.setAttribute("aria-label", T("Close template picker"));
      close.onclick = () => this.close();
      header.append(close);
      this.popup.append(header);
      const contexts = this.node("select");
      contexts.setAttribute("aria-label", T("Choose a project"));
      for (const c of this.catalog.contexts) {
        const o = this.node("option", c.label);
        o.value = c.id;
        contexts.append(o);
      }
      contexts.value = this.catalog.context.id;
      contexts.onchange = () => {
        this.popup.setAttribute("aria-busy", "true");
        this.onContext(contexts.value);
      };
      this.popup.append(contexts);
      const searchWrap = this.node("div", undefined, "template-search");
      this.search = this.node("input");
      this.search.placeholder = T("Search templates...");
      this.search.setAttribute("aria-label", T("Search templates..."));
      this.search.setAttribute("role", "combobox");
      this.search.setAttribute("aria-haspopup", "tree");
      this.search.setAttribute("aria-expanded", "true");
      this.search.setAttribute("aria-controls", "template-tree");
      this.search.value = this.query;
      searchWrap.append(this.icon("search"), this.search);
      this.popup.append(searchWrap);
      this.tree = this.node("div", undefined, "template-tree");
      this.tree.id = "template-tree";
      this.tree.setAttribute("role", "tree");
      this.tree.setAttribute("aria-label", T("Configuration Templates"));
      this.popup.append(this.tree);
      this.popup.append(
        this.node("div", T("↑ ↓ · Enter · Esc"), "template-shortcuts"),
      );
      this.search.oninput = () => {
        this.query = this.search.value;
        this.active = 0;
        this.rows();
      };
      this.popup.onkeydown = this.key;
      this.rows();
    }
    rows() {
      const T = this.translate;
      this.tree.replaceChildren();
      this.items = [];
      const templates = this.catalog.templates.filter((t) =>
        fuzzy(
          this.query,
          [
            t.label,
            T(t.label),
            t.language,
            t.group,
            T(t.group),
            t.description,
            T(t.description),
          ].join(" "),
        ),
      );
      const section = (label, entries, key) => {
        if (!entries.length) return;
        const searching = !!this.query.trim();
        const collapsed = !searching && this.collapsed.has(key);
        const group = this.node("div", undefined, "template-group");
        group.setAttribute("role", "group");
        group.setAttribute("aria-label", T(label));
        const head = this.node("button", undefined, "template-group-toggle");
        head.id = "template-group-" + this.items.length;
        head.setAttribute("role", "treeitem");
        head.setAttribute("aria-level", "1");
        head.setAttribute("aria-expanded", String(!collapsed));
        head.tabIndex = -1;
        head.append(
          this.icon(collapsed ? "chevron-right" : "chevron-down"),
          this.node("span", T(label)),
          this.node("span", String(entries.length), "template-count"),
        );
        const toggle = () => {
          if (this.collapsed.has(key)) this.collapsed.delete(key);
          else this.collapsed.add(key);
          this.rows();
        };
        head.onclick = toggle;
        this.tree.append(head, group);
        this.items.push({ node: head, action: toggle, group: key });
        if (collapsed) return;
        for (const template of entries) {
          const row = this.node("button", undefined, "template-option");
          row.id = "template-option-" + this.items.length;
          row.setAttribute("role", "treeitem");
          row.setAttribute("aria-level", "2");
          row.tabIndex = -1;
          const body = this.node("span", undefined, "template-copy");
          body.append(
            this.node("span", T(template.label), "template-name"),
            this.node("span", T(template.description), "template-description"),
          );
          const status = T(
            {
              ready: "Ready",
              missing: "Not Installed",
              configure: "Needs configuration",
              unchecked: "Not checked",
            }[template.status],
          );
          row.append(
            this.icon(template.icon),
            body,
            this.node("span", status, "template-state " + template.status),
          );
          row.title = T(template.description) + "\n" + T(template.reason);
          row.setAttribute(
            "aria-label",
            T(template.label) + " · " + status + " · " + T(template.reason),
          );
          const action = () => {
            this.close(false);
            this.onSelect(template, this.catalog.context);
          };
          row.onclick = action;
          const index = this.items.length;
          row.onpointermove = () => {
            this.active = index;
            this.highlight(false);
          };
          group.append(row);
          this.items.push({ node: row, action, template, group: key });
        }
      };
      const recent = this.getRecent?.() || this.catalog.recent || [];
      if (!this.query)
        section(
          "Recently Used",
          recent
            .map((id) => templates.find((t) => t.id === id))
            .filter(Boolean),
          "recent",
        );
      section(
        "Recommended for Current Project",
        templates.filter((t) => t.recommended),
        "recommended",
      );
      const all = this.node("div", T("All Templates"), "template-divider");
      all.setAttribute("role", "presentation");
      this.tree.append(all);
      for (const name of this.catalog.groups)
        section(
          name,
          templates.filter((t) => t.group === name),
          name,
        );
      if (!templates.length) {
        const empty = this.node("div", undefined, "template-empty");
        empty.append(
          this.icon("search-stop"),
          this.node("strong", T("No matching templates")),
          this.node("p", T("Try another name, language or description.")),
        );
        empty.setAttribute("role", "status");
        this.tree.append(empty);
      }
      this.active = Math.min(this.active, Math.max(0, this.items.length - 1));
      this.highlight(false);
    }
    highlight(scroll = true) {
      this.items.forEach((item, i) => {
        item.node.classList.toggle("keyboard-active", i === this.active);
        item.node.setAttribute("aria-selected", String(i === this.active));
      });
      const item = this.items[this.active];
      if (item) {
        this.search.setAttribute("aria-activedescendant", item.node.id);
        if (scroll) item.node.scrollIntoView({ block: "nearest" });
      } else this.search.removeAttribute("aria-activedescendant");
    }
    key(event) {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        this.close();
        return;
      }
      if (event.target.tagName === "SELECT") return;
      const directions = ["ArrowDown", "ArrowUp", "Home", "End"];
      if (directions.includes(event.key)) {
        event.preventDefault();
        this.active =
          event.key === "Home"
            ? 0
            : event.key === "End"
              ? this.items.length - 1
              : (this.active +
                  (event.key === "ArrowDown" ? 1 : -1) +
                  this.items.length) %
                Math.max(1, this.items.length);
        this.highlight();
      } else if (
        event.key === "Enter" &&
        event.target !== this.popup.querySelector(".template-heading button")
      ) {
        event.preventDefault();
        this.items[this.active]?.action();
      } else if (
        ["ArrowLeft", "ArrowRight"].includes(event.key) &&
        !this.search.value
      ) {
        const item = this.items[this.active];
        if (item?.group) {
          event.preventDefault();
          if (event.key === "ArrowLeft") this.collapsed.add(item.group);
          else this.collapsed.delete(item.group);
          this.rows();
        }
      }
    }
  }
  globalThis.AtelierTemplatePicker = { TemplatePicker, fuzzy };
})();
