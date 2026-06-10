import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { tmpdir } from "node:os";
import { listHanaOpportunities, saveHanaOpportunityRecord, saveRecordToHana } from "./hanaOpportunityStore.mjs";
import { buildStoredOpportunityRecord } from "./opportunityRecord.mjs";

const DEFAULT_STORE_PATH = isServerlessRuntime()
  ? resolve(tmpdir(), "sap-inquiry-ai-agent-opportunities.json")
  : resolve("data", "opportunities.json");

export async function listOpportunities(options = {}) {
  if (getStoreBackend(options) === "hana") {
    return listHanaOpportunities(options);
  }

  const records = await readStore(options.storePath);
  const limit = Number(options.limit || 50);

  return records
    .slice()
    .sort((a, b) => new Date(b.opportunity.createdAt) - new Date(a.opportunity.createdAt))
    .slice(0, limit);
}

export async function saveOpportunityRecord(result, options = {}) {
  if (getStoreBackend(options) === "hana") {
    return saveHanaOpportunityRecord(result, options);
  }

  const records = await readStore(options.storePath);
  const sourceMessageId = result.opportunity.sourceMessageId;
  const existingRecord = sourceMessageId
    ? records.find((item) => item.opportunity?.sourceMessageId === sourceMessageId)
    : null;
  const record = buildStoredOpportunityRecord(result, existingRecord);

  const nextRecords = [
    stripInternalFields(record),
    ...records.filter(
      (item) => item.id !== record.id && (!sourceMessageId || item.opportunity?.sourceMessageId !== sourceMessageId)
    )
  ];
  await writeStore(nextRecords, options.storePath);
  return stripInternalFields(record);
}

export async function saveOpportunitySnapshot(record, options = {}) {
  if (getStoreBackend(options) === "hana") {
    return saveRecordToHana(record, options);
  }

  const records = await readStore(options.storePath);
  const sourceMessageId = record.opportunity?.sourceMessageId || record.extracted?.source?.messageId || null;
  const publicRecord = stripInternalFields(record);
  const nextRecords = [
    publicRecord,
    ...records.filter(
      (item) => item.id !== publicRecord.id && (!sourceMessageId || item.opportunity?.sourceMessageId !== sourceMessageId)
    )
  ];

  await writeStore(nextRecords, options.storePath);
  return publicRecord;
}

async function readStore(storePath = process.env.OPPORTUNITY_STORE_PATH || DEFAULT_STORE_PATH) {
  try {
    return JSON.parse(await readFile(storePath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

async function writeStore(records, storePath = process.env.OPPORTUNITY_STORE_PATH || DEFAULT_STORE_PATH) {
  await mkdir(dirname(storePath), { recursive: true });
  await writeFile(storePath, `${JSON.stringify(records, null, 2)}\n`);
}

function getStoreBackend(options) {
  return String(options.backend || process.env.OPPORTUNITY_STORE_BACKEND || "file").toLowerCase();
}

function stripInternalFields(record) {
  const { sourceMessageId, ...publicRecord } = record;
  return publicRecord;
}

function isServerlessRuntime() {
  return Boolean(process.env.VERCEL || process.env.NETLIFY || process.env.AWS_LAMBDA_FUNCTION_NAME);
}
