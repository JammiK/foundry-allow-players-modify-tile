const MODULE_ID = "allow-player-create-tile";
const PATCHED = Symbol.for(`${MODULE_ID}.patched`);
const SOCKET_EVENT = `module.${MODULE_ID}`;
const RPC_TIMEOUT_MS = 10_000;

const pendingRpcs = new Map();

function settingEnabled() {
  return game.settings.get(MODULE_ID, "enablePlayerTileEditing") === true;
}

function isActiveCanvasScene(scene) {
  return !!scene && scene.id === canvas?.scene?.id;
}

function isPlayerTileEditingAllowed(user, scene) {
  if (!settingEnabled()) return false;
  if (!user || user.isGM) return false;
  return isActiveCanvasScene(scene);
}

function getPrimaryGM() {
  const activeGms = [...(game.users ?? [])].filter((u) => u.active && u.isGM);
  activeGms.sort((a, b) => String(a.id).localeCompare(String(b.id)));
  return activeGms[0] ?? null;
}

function pickRpcOptions(options) {
  if (!options || typeof options !== "object") return {};
  const allowedKeys = ["animate", "diff", "render", "recursive", "noHook"];
  const picked = {};
  for (const key of allowedKeys) {
    if (key in options) picked[key] = options[key];
  }
  return picked;
}

function requestGM(op, payload) {
  const gm = getPrimaryGM();
  if (!gm) throw new Error("No active GM is connected.");

  const requestId = foundry.utils.randomID();
  const message = {
    v: 1,
    action: "request",
    requestId,
    senderId: game.user.id,
    targetGM: gm.id,
    op,
    payload,
  };

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      pendingRpcs.delete(requestId);
      reject(new Error("Timed out waiting for GM response."));
    }, RPC_TIMEOUT_MS);

    pendingRpcs.set(requestId, { resolve, reject, timeout });
    game.socket.emit(SOCKET_EVENT, message);
  });
}

async function waitForDocuments(collection, ids, attempts = 10, delayMs = 50) {
  for (let i = 0; i < attempts; i++) {
    const docs = ids.map((id) => collection.get(id)).filter(Boolean);
    if (docs.length === ids.length) return docs;
    await new Promise((r) => setTimeout(r, delayMs));
  }
  return ids.map((id) => collection.get(id)).filter(Boolean);
}

function wrapMethod(target, key, wrapper) {
  const original = target?.[key];
  if (typeof original !== "function") return false;
  if (original[PATCHED]) return false;
  target[key] = wrapper(original);
  target[key][PATCHED] = true;
  return true;
}

function wrapGetter(target, key, wrapper) {
  const desc = Object.getOwnPropertyDescriptor(target, key);
  if (!desc?.get || typeof desc.get !== "function") return false;
  if (desc.get[PATCHED]) return false;
  const newGet = wrapper(desc.get);
  newGet[PATCHED] = true;
  Object.defineProperty(target, key, {
    configurable: true,
    enumerable: desc.enumerable ?? false,
    get: newGet,
  });
  return true;
}

function patchTileDocumentPermissions() {
  const TileDocumentClass = CONFIG?.Tile?.documentClass;
  if (!TileDocumentClass) return;

  wrapMethod(TileDocumentClass, "create", (original) => {
    return async function (data, options = {}) {
      const parent = options?.parent;
      if (isPlayerTileEditingAllowed(game.user, parent)) {
        const scene = parent;
        const result = await requestGM("tile.create", {
          sceneId: scene.id,
          data: [data],
          options: pickRpcOptions(options),
        });
        const ids = result?.documentIds ?? [];
        const docs = await waitForDocuments(scene.tiles, ids);
        return docs[0] ?? null;
      }
      return original.call(this, data, options);
    };
  });

  wrapMethod(TileDocumentClass, "canUserCreate", (original) => {
    return function (user, parent, data) {
      if (isPlayerTileEditingAllowed(user, parent)) return true;
      return original.call(this, user, parent, data);
    };
  });

  wrapMethod(TileDocumentClass.prototype, "update", (original) => {
    return async function (changes = {}, options = {}) {
      if (isPlayerTileEditingAllowed(game.user, this.parent)) {
        const result = await requestGM("tile.update", {
          sceneId: this.parent.id,
          documentId: this.id,
          changes,
          options: pickRpcOptions(options),
        });
        const ids = result?.documentIds ?? [this.id];
        const docs = await waitForDocuments(this.parent.tiles, ids);
        return docs[0] ?? this;
      }
      return original.call(this, changes, options);
    };
  });

  wrapMethod(TileDocumentClass.prototype, "delete", (original) => {
    return async function (options = {}) {
      if (isPlayerTileEditingAllowed(game.user, this.parent)) {
        await requestGM("tile.delete", {
          sceneId: this.parent.id,
          documentId: this.id,
          options: pickRpcOptions(options),
        });
        return this;
      }
      return original.call(this, options);
    };
  });

  wrapMethod(TileDocumentClass.prototype, "canUserModify", (original) => {
    return function (user, action, data) {
      if (isPlayerTileEditingAllowed(user, this.parent)) return true;
      return original.call(this, user, action, data);
    };
  });

  wrapMethod(TileDocumentClass.prototype, "testUserPermission", (original) => {
    return function (user, permission, options) {
      if (isPlayerTileEditingAllowed(user, this.parent)) return true;
      return original.call(this, user, permission, options);
    };
  });
}

function patchTileLayerCapabilities() {
  const TileLayerClass =
    globalThis.TilesLayer ??
    globalThis.TileLayer ??
    CONFIG?.Canvas?.layers?.tiles?.layerClass ??
    canvas?.tiles?.constructor;
  if (!TileLayerClass?.prototype) return;

  const allow = () => settingEnabled() && !game.user.isGM;

  const orAllow = (value) => (value === true ? true : allow());

  wrapGetter(TileLayerClass.prototype, "canDragCreate", (originalGet) => {
    return function () {
      return orAllow(originalGet.call(this));
    };
  });

  wrapGetter(TileLayerClass.prototype, "canCreate", (originalGet) => {
    return function () {
      return orAllow(originalGet.call(this));
    };
  });

  wrapGetter(TileLayerClass.prototype, "canControl", (originalGet) => {
    return function () {
      return orAllow(originalGet.call(this));
    };
  });

  wrapMethod(TileLayerClass.prototype, "canDragCreate", (original) => {
    return function (...args) {
      return original.call(this, ...args) || allow();
    };
  });

  wrapMethod(TileLayerClass.prototype, "canCreate", (original) => {
    return function (...args) {
      return original.call(this, ...args) || allow();
    };
  });

  wrapMethod(TileLayerClass.prototype, "canControl", (original) => {
    return function (...args) {
      return original.call(this, ...args) || allow();
    };
  });
}

function applyTileLayerOptions() {
  if (!settingEnabled() || game.user.isGM) return;
  const layer = canvas?.tiles;
  if (!layer?.options) return;

  layer.options.canDragCreate = true;
  layer.options.canCreate = true;
  layer.options.canControl = true;
}

function refreshSceneControls() {
  try {
    ui.controls?.initialize?.();
    ui.controls?.render?.(true);
  } catch (_) {
    // ignore
  }
}

function patchSceneEmbeddedTileOperations() {
  const SceneDocumentClass = CONFIG?.Scene?.documentClass;
  if (!SceneDocumentClass?.prototype) return;

  wrapMethod(SceneDocumentClass.prototype, "createEmbeddedDocuments", (original) => {
    return async function (embeddedName, data = [], options = {}) {
      if (embeddedName === "Tile" && isPlayerTileEditingAllowed(game.user, this)) {
        const result = await requestGM("tile.create", {
          sceneId: this.id,
          data,
          options: pickRpcOptions(options),
        });
        const ids = result?.documentIds ?? [];
        return waitForDocuments(this.tiles, ids);
      }
      return original.call(this, embeddedName, data, options);
    };
  });

  wrapMethod(SceneDocumentClass.prototype, "updateEmbeddedDocuments", (original) => {
    return async function (embeddedName, updates = [], options = {}) {
      if (embeddedName === "Tile" && isPlayerTileEditingAllowed(game.user, this)) {
        const result = await requestGM("tile.updateMany", {
          sceneId: this.id,
          updates,
          options: pickRpcOptions(options),
        });
        const ids = result?.documentIds ?? updates.map((u) => u?._id ?? u?.id).filter(Boolean);
        return waitForDocuments(this.tiles, ids);
      }
      return original.call(this, embeddedName, updates, options);
    };
  });

  wrapMethod(SceneDocumentClass.prototype, "deleteEmbeddedDocuments", (original) => {
    return async function (embeddedName, ids = [], options = {}) {
      if (embeddedName === "Tile" && isPlayerTileEditingAllowed(game.user, this)) {
        await requestGM("tile.deleteMany", {
          sceneId: this.id,
          ids,
          options: pickRpcOptions(options),
        });
        return [];
      }
      return original.call(this, embeddedName, ids, options);
    };
  });
}

function patchSceneControlsVisibility() {
  const defaultTools = () => ([
    {
      name: "select",
      title: "CONTROLS.CommonSelect",
      icon: "fas fa-expand",
      toggle: true,
      active: true,
      visible: true,
      restricted: false,
      gmOnly: false,
    },
    {
      name: "tile",
      title: "CONTROLS.TileDraw",
      icon: "fas fa-cube",
      toggle: true,
      visible: true,
      restricted: false,
      gmOnly: false,
    },
  ]);

  Hooks.on("getSceneControlButtons", (controls) => {
    if (!settingEnabled() || game.user.isGM) return;

    let tiles = controls.find((c) => c.name === "tiles" || c.layer === "tiles");

    if (!tiles) {
      tiles = {
        name: "tiles",
        title: "CONTROLS.TileLayer",
        icon: "fas fa-cubes",
        layer: "tiles",
        visible: true,
        restricted: false,
        gmOnly: false,
        permission: true,
        tools: defaultTools(),
      };

      controls.push(tiles);
    }

    if (!Array.isArray(tiles.tools) || tiles.tools.length === 0) {
      tiles.tools = defaultTools();
    }

    tiles.visible = true;
    tiles.restricted = false;
    tiles.gmOnly = false;
    tiles.permission = true;
    for (const tool of tiles.tools ?? []) {
      tool.visible = true;
      tool.restricted = false;
      tool.gmOnly = false;
    }
  });
}

Hooks.once("init", () => {
  game.settings.register(MODULE_ID, "enablePlayerTileEditing", {
    name: game.i18n.localize(`${MODULE_ID}.settings.enable.name`),
    hint: game.i18n.localize(`${MODULE_ID}.settings.enable.hint`),
    scope: "world",
    config: true,
    type: Boolean,
    default: false,
    requiresReload: false,
    onChange: () => {
      applyTileLayerOptions();
      refreshSceneControls();
    },
  });

  patchTileDocumentPermissions();
  patchTileLayerCapabilities();
  patchSceneEmbeddedTileOperations();
  patchSceneControlsVisibility();
});

Hooks.once("ready", () => {
  patchTileLayerCapabilities();
  applyTileLayerOptions();
  refreshSceneControls();

  Hooks.on("canvasReady", () => {
    applyTileLayerOptions();
    refreshSceneControls();
  });

  game.socket.on(SOCKET_EVENT, async (message) => {
    if (!message || typeof message !== "object") return;

    if (message.action === "response") {
      if (message.recipientId && message.recipientId !== game.user.id) return;
      const pending = pendingRpcs.get(message.requestId);
      if (!pending) return;
      pendingRpcs.delete(message.requestId);
      clearTimeout(pending.timeout);
      if (message.ok) pending.resolve(message.result);
      else pending.reject(new Error(message.error ?? "GM request failed."));
      return;
    }

    if (message.action !== "request") return;
    if (!game.user.isGM) return;
    if (message.targetGM && message.targetGM !== game.user.id) return;

    const respond = (ok, result, error) => {
      game.socket.emit(SOCKET_EVENT, {
        v: 1,
        action: "response",
        requestId: message.requestId,
        recipientId: message.senderId,
        ok,
        result,
        error,
      });
    };

    if (!settingEnabled()) {
      respond(false, null, "Player tile editing is disabled by the GM.");
      return;
    }

    try {
      const { op, payload } = message;
      const scene = game.scenes.get(payload?.sceneId);
      if (!scene) throw new Error("Scene not found.");

      if (op === "tile.create") {
        const created = await scene.createEmbeddedDocuments("Tile", payload.data ?? [], payload.options ?? {});
        respond(true, { documentIds: created.map((d) => d.id) });
        return;
      }

      if (op === "tile.updateMany") {
        const updated = await scene.updateEmbeddedDocuments("Tile", payload.updates ?? [], payload.options ?? {});
        respond(true, { documentIds: updated.map((d) => d.id) });
        return;
      }

      if (op === "tile.deleteMany") {
        await scene.deleteEmbeddedDocuments("Tile", payload.ids ?? [], payload.options ?? {});
        respond(true, { documentIds: payload.ids ?? [] });
        return;
      }

      const tile = scene.tiles.get(payload?.documentId);
      if (!tile) throw new Error("Tile not found.");

      if (op === "tile.update") {
        const updated = await tile.update(payload.changes ?? {}, payload.options ?? {});
        respond(true, { documentIds: [updated?.id ?? tile.id] });
        return;
      }

      if (op === "tile.delete") {
        await tile.delete(payload.options ?? {});
        respond(true, { documentIds: [tile.id] });
        return;
      }

      throw new Error(`Unknown operation: ${String(op)}`);
    } catch (err) {
      respond(false, null, err?.message ?? String(err));
    }
  });

  if (game.user.isGM && settingEnabled()) {
    ui.notifications?.info(game.i18n.localize(`${MODULE_ID}.notifications.enabledGM`));
  }
});
