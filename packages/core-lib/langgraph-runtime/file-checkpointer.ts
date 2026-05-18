import { readFile, writeFile, mkdir } from "fs/promises";
import { dirname, join } from "path";
import { BaseCheckpointSaver, WRITES_IDX_MAP, TASKS, copyCheckpoint, getCheckpointId, maxChannelVersion } from "@langchain/langgraph-checkpoint";

const SERIALIZED_UINT8_ARRAY = "__serialized_uint8_array__";

function generateKey(threadId, checkpointNamespace, checkpointId) {
  return JSON.stringify([threadId, checkpointNamespace || "", checkpointId]);
}

function parseKey(key) {
  const [threadId, checkpointNamespace, checkpointId] = JSON.parse(key);
  return { threadId, checkpointNamespace, checkpointId };
}

async function readJson(file, fallback) {
  try {
    return JSON.parse(await readFile(file, "utf-8"));
  } catch {
    return fallback;
  }
}

async function writeJson(file, value) {
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(value, null, 2));
}

function encodeSerializedValue(value) {
  if (value instanceof Uint8Array) {
    return {
      type: SERIALIZED_UINT8_ARRAY,
      data: Buffer.from(value).toString("base64"),
    };
  }
  return value;
}

function decodeSerializedValue(value) {
  if (value?.type === SERIALIZED_UINT8_ARRAY && typeof value.data === "string") {
    return Uint8Array.from(Buffer.from(value.data, "base64"));
  }

  if (value && typeof value === "object" && !Array.isArray(value)) {
    const keys = Object.keys(value);
    if (keys.length && keys.every((key) => /^\d+$/.test(key))) {
      const sortedKeys = keys.map(Number).sort((a, b) => a - b);
      const isContiguous = sortedKeys.every((key, index) => key === index);
      if (isContiguous) return Uint8Array.from(sortedKeys.map((key) => value[key]));
    }
  }

  return value;
}

export class FileCheckpointSaver extends BaseCheckpointSaver {
  constructor(rootDir, serde) {
    super(serde);
    this.rootDir = rootDir;
    this.storageFile = join(rootDir, "langgraph-checkpoints.json");
    this.writesFile = join(rootDir, "langgraph-writes.json");
    this.storage = null;
    this.writes = null;
  }

  async ensureLoaded() {
    if (this.storage && this.writes) return;
    await mkdir(this.rootDir, { recursive: true });
    this.storage = await readJson(this.storageFile, {});
    this.writes = await readJson(this.writesFile, {});
  }

  async persist() {
    await writeJson(this.storageFile, this.storage || {});
    await writeJson(this.writesFile, this.writes || {});
  }

  async migratePendingSends(mutableCheckpoint, threadId, checkpointNs, parentCheckpointId) {
    const parentKey = generateKey(threadId, checkpointNs, parentCheckpointId);
    const pendingSends = await Promise.all(Object.values(this.writes[parentKey] ?? {})
      .filter(([_taskId, channel]) => channel === TASKS)
      .map(async ([_taskId, _channel, writes]) => await this.serde.loadsTyped("json", decodeSerializedValue(writes))));
    mutableCheckpoint.channel_values ??= {};
    mutableCheckpoint.channel_values[TASKS] = pendingSends;
    mutableCheckpoint.channel_versions ??= {};
    mutableCheckpoint.channel_versions[TASKS] = Object.keys(mutableCheckpoint.channel_versions).length > 0
      ? maxChannelVersion(...Object.values(mutableCheckpoint.channel_versions))
      : this.getNextVersion(undefined);
  }

  async createTuple(threadId, checkpointNamespace, checkpointId, saved, config) {
    const [checkpoint, metadata, parentCheckpointId] = saved;
    const key = generateKey(threadId, checkpointNamespace, checkpointId);
    const deserializedCheckpoint = await this.serde.loadsTyped("json", decodeSerializedValue(checkpoint));
    if (deserializedCheckpoint.v < 4 && parentCheckpointId !== undefined) {
      await this.migratePendingSends(deserializedCheckpoint, threadId, checkpointNamespace, parentCheckpointId);
    }
    const pendingWrites = await Promise.all(Object.values(this.writes[key] || {}).map(async ([taskId, channel, value]) => [
      taskId,
      channel,
      await this.serde.loadsTyped("json", decodeSerializedValue(value)),
    ]));
    const checkpointTuple = {
      config,
      checkpoint: deserializedCheckpoint,
      metadata: await this.serde.loadsTyped("json", decodeSerializedValue(metadata)),
      pendingWrites,
    };
    if (parentCheckpointId !== undefined) {
      checkpointTuple.parentConfig = {
        configurable: {
          thread_id: threadId,
          checkpoint_ns: checkpointNamespace,
          checkpoint_id: parentCheckpointId,
        },
      };
    }
    return checkpointTuple;
  }

  async getTuple(config) {
    await this.ensureLoaded();
    const threadId = config.configurable?.thread_id;
    const checkpointNamespace = config.configurable?.checkpoint_ns ?? "";
    let checkpointId = getCheckpointId(config);
    if (!threadId) return undefined;

    if (checkpointId) {
      const saved = this.storage[threadId]?.[checkpointNamespace]?.[checkpointId];
      if (!saved) return undefined;
      return this.createTuple(threadId, checkpointNamespace, checkpointId, saved, config);
    }

    const checkpoints = this.storage[threadId]?.[checkpointNamespace];
    if (!checkpoints) return undefined;
    checkpointId = Object.keys(checkpoints).sort((a, b) => b.localeCompare(a))[0];
    if (!checkpointId) return undefined;
    return this.createTuple(threadId, checkpointNamespace, checkpointId, checkpoints[checkpointId], {
      configurable: {
        thread_id: threadId,
        checkpoint_id: checkpointId,
        checkpoint_ns: checkpointNamespace,
      },
    });
  }

  async *list(config, options) {
    await this.ensureLoaded();
    let { before, limit, filter } = options ?? {};
    const threadIds = config.configurable?.thread_id ? [config.configurable.thread_id] : Object.keys(this.storage);
    const configCheckpointNamespace = config.configurable?.checkpoint_ns;
    const configCheckpointId = config.configurable?.checkpoint_id;

    for (const threadId of threadIds) {
      for (const checkpointNamespace of Object.keys(this.storage[threadId] ?? {})) {
        if (configCheckpointNamespace !== undefined && checkpointNamespace !== configCheckpointNamespace) continue;
        const checkpoints = this.storage[threadId]?.[checkpointNamespace] ?? {};
        const sortedCheckpoints = Object.entries(checkpoints).sort((a, b) => b[0].localeCompare(a[0]));
        for (const [checkpointId, saved] of sortedCheckpoints) {
          if (configCheckpointId && checkpointId !== configCheckpointId) continue;
          if (before?.configurable?.checkpoint_id && checkpointId >= before.configurable.checkpoint_id) continue;
          const metadata = await this.serde.loadsTyped("json", decodeSerializedValue(saved[1]));
          if (filter && !Object.entries(filter).every(([key, value]) => metadata[key] === value)) continue;
          if (limit !== undefined) {
            if (limit <= 0) break;
            limit -= 1;
          }
          yield await this.createTuple(threadId, checkpointNamespace, checkpointId, saved, {
            configurable: {
              thread_id: threadId,
              checkpoint_ns: checkpointNamespace,
              checkpoint_id: checkpointId,
            },
          });
        }
      }
    }
  }

  async put(config, checkpoint, metadata) {
    await this.ensureLoaded();
    const preparedCheckpoint = copyCheckpoint(checkpoint);
    const threadId = config.configurable?.thread_id;
    const checkpointNamespace = config.configurable?.checkpoint_ns ?? "";
    if (threadId === undefined) throw new Error("checkpoint thread_id is required");
    this.storage[threadId] ??= {};
    this.storage[threadId][checkpointNamespace] ??= {};
    const [[, serializedCheckpoint], [, serializedMetadata]] = await Promise.all([
      this.serde.dumpsTyped(preparedCheckpoint),
      this.serde.dumpsTyped(metadata),
    ]);
    this.storage[threadId][checkpointNamespace][checkpoint.id] = [
      encodeSerializedValue(serializedCheckpoint),
      encodeSerializedValue(serializedMetadata),
      config.configurable?.checkpoint_id,
    ];
    await this.persist();
    return {
      configurable: {
        thread_id: threadId,
        checkpoint_ns: checkpointNamespace,
        checkpoint_id: checkpoint.id,
      },
    };
  }

  async putWrites(config, writes, taskId) {
    await this.ensureLoaded();
    const threadId = config.configurable?.thread_id;
    const checkpointNamespace = config.configurable?.checkpoint_ns;
    const checkpointId = config.configurable?.checkpoint_id;
    if (threadId === undefined) throw new Error("checkpoint thread_id is required");
    if (checkpointId === undefined) throw new Error("checkpoint_id is required");
    const outerKey = generateKey(threadId, checkpointNamespace, checkpointId);
    const existingWrites = this.writes[outerKey];
    this.writes[outerKey] ??= {};
    await Promise.all(writes.map(async ([channel, value], index) => {
      const [, serializedValue] = await this.serde.dumpsTyped(value);
      const innerKey = [taskId, WRITES_IDX_MAP[channel] || index];
      const innerKeyStr = `${innerKey[0]},${innerKey[1]}`;
      if (innerKey[1] >= 0 && existingWrites && innerKeyStr in existingWrites) return;
      this.writes[outerKey][innerKeyStr] = [taskId, channel, encodeSerializedValue(serializedValue)];
    }));
    await this.persist();
  }

  async deleteThread(threadId) {
    await this.ensureLoaded();
    delete this.storage[threadId];
    for (const key of Object.keys(this.writes)) {
      if (parseKey(key).threadId === threadId) delete this.writes[key];
    }
    await this.persist();
  }
}
