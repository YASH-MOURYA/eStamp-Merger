// Reads the transaction JSON and turns it into plain, predictable data:
//   documents -> every PDF found in `documentdtls`
//   groups    -> one group per (relation to contract + document list)
//
// Key names differ between exports, so every lookup tries several spellings.
// If your JSON uses other names, add them to the *_KEYS lists below.

const ROOT_KEYS = ["loan"];
const DOC_LIST_KEYS = ["documentdtls", "documents", "documentDetails"];
const PART_LIST_KEYS = ["prtcptentty", "prtcptenttydtls", "participants"];

const DOC_ID_KEYS = ["documentID", "documentId", "docID", "docId", "documentNo", "documentNumber", "docNo", "docRefId", "docRefNo", "refId", "uniqueId", "id"];
const DOC_NAME_KEYS = ["documentName", "docName", "documentNm", "docNm", "fileName", "name", "documentType", "docType"];
const DOC_DATA_KEYS = ["docData", "documentData", "base64", "fileData"];

const REL_KEYS = ["reltocntrct", "relToCntrct", "relationToContract", "relation"];
const PART_NAME_KEYS = ["fulnm", "prtcpntnm", "participantName", "name", "entityName"];
const PART_DOC_KEYS = ["documentID", "documentId", "documentIds", "documentIDs", "docIds", "docID", "docId"];

/** Case-insensitive property lookup that tries several names. */
export function getValue(object, names) {
  if (!object || typeof object !== "object") return undefined;
  const keys = Object.keys(object);
  for (const name of names) {
    const key = keys.find((item) => item.toLowerCase() === name.toLowerCase());
    if (key !== undefined) return object[key];
  }
  return undefined;
}

/** Last-resort search: first array of objects (anywhere in the JSON) that passes `test`. */
function findArray(node, test, depth = 0) {
  if (depth > 6 || !node || typeof node !== "object") return undefined;
  if (Array.isArray(node) && node.length && node.every((x) => x && typeof x === "object") && test(node)) {
    return node;
  }
  for (const child of Array.isArray(node) ? node : Object.values(node)) {
    const found = findArray(child, test, depth + 1);
    if (found) return found;
  }
  return undefined;
}

export function decodeBase64(value) {
  let text = String(value ?? "").trim();
  const comma = text.indexOf(",");
  if (comma !== -1 && text.slice(0, comma).toLowerCase().includes("base64")) {
    text = text.slice(comma + 1); // strip "data:application/pdf;base64,"
  }
  text = text.replace(/\s/g, "").replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** "creditor" / "DEBTOR" / "co_borrower" -> "Creditor" / "Debtor" / "Co Borrower" */
export function formatRelation(value) {
  const text = String(value ?? "").trim().replace(/[_-]+/g, " ").replace(/\s+/g, " ");
  if (!text) return "Participant";
  return text.toLowerCase().replace(/(^|\s)\p{L}/gu, (match) => match.toUpperCase());
}

function relationRank(label) {
  const key = label.toLowerCase();
  if (key === "creditor") return 0;
  if (key === "debtor") return 1;
  return 2;
}

/** Accepts ["1","2"], [{documentID:"1"}], "1,2" or 1 and returns ["1","2"]. */
function toIdList(raw) {
  if (raw === undefined || raw === null || raw === "") return [];
  if (Array.isArray(raw)) {
    return raw.flatMap((item) =>
      item && typeof item === "object" ? toIdList(getValue(item, DOC_ID_KEYS)) : toIdList(item)
    );
  }
  if (typeof raw === "object") return toIdList(getValue(raw, DOC_ID_KEYS));
  return String(raw).split(",").map((part) => part.trim()).filter(Boolean);
}

/** If no known ID key exists, use the first short value stored under a key ending in "id". */
function guessId(item) {
  for (const [key, value] of Object.entries(item ?? {})) {
    if (!/id$/i.test(key) || DOC_DATA_KEYS.some((k) => k.toLowerCase() === key.toLowerCase())) continue;
    if ((typeof value === "string" || typeof value === "number") && String(value).trim() && String(value).length <= 80) {
      return value;
    }
  }
  return undefined;
}

const isPrimitive = (v) => v !== null && v !== undefined && typeof v !== "object";

/** Real document ID: known key names first, then any "doc...id/no/seq" key, then any "...id" key. */
function pickDocId(item) {
  const explicit = getValue(item, DOC_ID_KEYS);
  if (isPrimitive(explicit) && String(explicit).trim() !== "") return String(explicit).trim();
  const keys = Object.keys(item).filter((k) => isPrimitive(item[k]) && String(item[k]).trim() !== "" && String(item[k]).length < 60);
  const key =
    keys.find((k) => /^(doc|document)[ _-]?(id|no|num|number|seq|sr)/i.test(k)) ??
    keys.find((k) => /id$/i.test(k));
  return key ? String(item[key]).trim() : "";
}

/** Participant's document-ID list: known key names first, then any "doc...id/no" key. */
function pickParticipantDocs(participant) {
  const explicit = getValue(participant, PART_DOC_KEYS);
  if (explicit !== undefined) return explicit;
  const key = Object.keys(participant).find((k) => /^(doc|document)/i.test(k) && /(id|no|num)/i.test(k));
  return key ? participant[key] : undefined;
}

const ID_LIKE = /(^id$|id$|uid$|refno|docno|docnum)/i;
const NAME_LIKE = /(name|nm$|title|desc|type)/i;

/** Real document ID: known key names first, then any key that looks like an ID. */
function pickDocumentId(item, dataKey) {
  const known = getValue(item, DOC_ID_KEYS);
  if (known !== undefined && known !== null && String(known).trim()) return String(known).trim();
  for (const [key, value] of Object.entries(item)) {
    if (key === dataKey || value === null || typeof value === "object") continue;
    if (ID_LIKE.test(key) && String(value).trim() && String(value).length < 80) return String(value).trim();
  }
  return "";
}

function pickDocumentName(item, id) {
  const known = getValue(item, DOC_NAME_KEYS);
  if (known !== undefined && known !== null && String(known).trim()) return String(known).trim();
  for (const [key, value] of Object.entries(item)) {
    if (typeof value !== "string" || !NAME_LIKE.test(key) || ID_LIKE.test(key)) continue;
    const text = value.trim();
    if (text && text.length < 80 && text !== id) return text;
  }
  return "";
}

function readDocuments(root, data, warnings) {
  let list = getValue(root, DOC_LIST_KEYS);
  if (!Array.isArray(list)) {
    list = findArray(data, (items) => items.some((item) => getValue(item, DOC_DATA_KEYS) !== undefined)) ?? [];
  }

  const documents = [];
  let positional = false;
  list.forEach((item, index) => {
    const dataKey = Object.keys(item).find((k) => DOC_DATA_KEYS.some((n) => n.toLowerCase() === k.toLowerCase()));
    const base64 = String(getValue(item, DOC_DATA_KEYS) ?? "").trim();
    if (!base64) return;
    let id = pickDocumentId(item, dataKey);
    if (!id) {
      id = String(index + 1);
      positional = true;
      warnings.push(
        `Document #${index + 1} has no document ID field. Fields found: ${Object.keys(item).filter((k) => k !== dataKey).join(", ") || "none"}.`
      );
    }
    try {
      documents.push({ id, name: pickDocumentName(item, id), bytes: decodeBase64(base64) });
    } catch {
      warnings.push(`Document ${id} has invalid Base64 data and was skipped.`);
    }
  });
  if (positional) warnings.push("Position numbers are used where the ID is missing; add its key name to DOC_ID_KEYS in src/lib/parse.js.");
  return documents;
}

/**
 * Groups participants by the SET of documents they hold - not by relation.
 *  - everyone holds the same documents  -> ONE group  -> ONE merged PDF for all of them
 *  - different participants hold different documents -> one group (and one merged PDF) per distinct set
 * Each group remembers which relations (creditor, debtor, co-obligant ...) it serves, so the ZIP can
 * place the file in each relation's folder.
 */
function readGroups(root, data, documents) {
  if (!documents.length) return [];
  let list = getValue(root, PART_LIST_KEYS);
  if (!Array.isArray(list)) {
    list = findArray(data, (items) => items.some((item) => getValue(item, REL_KEYS) !== undefined)) ?? [];
  }

  const allIds = documents.map((d) => d.id);
  const groups = new Map();
  list.forEach((participant, index) => {
    const raw = String(getValue(participant, REL_KEYS) ?? "").trim();
    const label = formatRelation(raw);
    const listed = [...new Set(toIdList(pickParticipantDocs(participant)))];
    const documentIds = listed.length ? listed : allIds; // no list = holds every document
    const name = String(getValue(participant, PART_NAME_KEYS) ?? `Participant ${index + 1}`).trim();

    const key = [...documentIds].sort().join("|");
    if (!groups.has(key)) {
      groups.set(key, { key, documentIds, participants: [], members: [], relations: [], order: groups.size });
    }
    const group = groups.get(key);
    if (!group.participants.includes(name)) group.participants.push(name);
    group.members.push({ name, relation: raw, relationLabel: label });
    if (!group.relations.some((r) => r.label === label)) group.relations.push({ label, raw });
  });

  if (!groups.size) {
    groups.set("all", {
      key: "all",
      documentIds: allIds,
      participants: ["All documents"],
      members: [],
      relations: [{ label: "Participant", raw: "" }],
      order: 0,
    });
  }

  const result = [...groups.values()];
  result.forEach((g) => g.relations.sort((x, y) => relationRank(x.label) - relationRank(y.label)));
  return result.sort(
    (x, y) => relationRank(x.relations[0].label) - relationRank(y.relations[0].label) || x.order - y.order
  );
}

const REQ_LIST_KEYS = ["estampdtls", "estampDetails", "estampdetails"];
const text = (value) => (value === undefined || value === null ? "" : String(value).trim());

/**
 * eStamp requests (`estampdtls`). Each request = ONE eStamp that must be attached,
 * placed before the document named in its `documentID`.
 */
function readStampRequests(root, data) {
  let list = getValue(root, REQ_LIST_KEYS);
  if (!Array.isArray(list)) {
    list =
      findArray(data, (items) => items.some((item) => getValue(item, ["stampDutyAmount", "articleCode"]) !== undefined)) ?? [];
  }
  return list
    .filter((item) => item && typeof item === "object")
    .map((item, index) => ({
      key: `request-${index + 1}`,
      documentId: text(getValue(item, DOC_ID_KEYS)),
      description: text(getValue(item, ["descriptionofDocument", "description"])),
      firstParty: text(getValue(item, ["firstparty", "firstParty"])),
      secondParty: text(getValue(item, ["secondparty", "secondParty"])),
      amount: text(getValue(item, ["stampDutyAmount"])),
    }));
}

export function parseTransaction(data) {
  const warnings = [];
  const first = ROOT_KEYS.map((key) => getValue(data, [key])).find(Boolean);
  const root = Array.isArray(first) ? first[0] : first ?? data;

  const documents = readDocuments(root, data, warnings);
  const groups = readGroups(root, data, documents);
  const requests = readStampRequests(root, data);

  const known = new Set(documents.map((d) => d.id));
  const missing = new Set(groups.flatMap((g) => g.documentIds).filter((id) => !known.has(id)));
  if (missing.size) {
    warnings.push(`Participants reference document ID(s) not found in the JSON: ${[...missing].join(", ")}.`);
  }
  const noIdRequests = requests.filter((r) => !r.documentId).length;
  if (noIdRequests) warnings.push(`${noIdRequests} eStamp request(s) have no documentID and cannot be placed.`);
  const missingStampDocs = requests.filter((r) => r.documentId && !known.has(r.documentId)).map((r) => r.documentId);
  if (missingStampDocs.length) {
    warnings.push(`eStamp request(s) point to document ID(s) not found in the JSON: ${[...new Set(missingStampDocs)].join(", ")}.`);
  }
  return { documents, groups, requests, warnings };
}
